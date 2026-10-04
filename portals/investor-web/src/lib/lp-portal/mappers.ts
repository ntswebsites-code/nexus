import type {
  LpAccountActivityEntry,
  LpCapitalCall,
  LpCapitalCallDetail,
  LpDashboardAction,
  LpDealingRequest,
  LpDistribution,
  LpDocument,
  LpMessageThreadDetail,
  LpMessageThreadSummary,
  LpNotice,
  LpOpenEndedHistoryPoint,
  LpPerformanceHistoryPoint,
  LpRecentActivity,
  LpServiceRequest,
  LpSessionFund,
} from "@/lib/api/lp-portal-api"
import { daysUntil, formatDate, formatFileSize, formatMoneyCompact, parseDecimal } from "@/lib/lp-portal/format"
import type { LpFund } from "@/lib/lp-portal/types"

/**
 * "AWAITING_FUNDS" -> "Awaiting Funds". The API sends enum values in upper case; lower-casing
 * first is what lets the status badges, filters and counts (which compare against title-case
 * labels) match. Without it the UI showed "AWAITING FUNDS" and the "Awaiting Funds" filter,
 * badge colour and counts never matched.
 */
export function titleCaseEnum(value: string): string {
  return value.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function mapSessionFund(fund: LpSessionFund): LpFund {
  return {
    id: fund.fundId,
    publicReference: fund.publicReference,
    name: fund.fundName,
    shortName: fund.shortName,
    operatingModel: fund.operatingModel,
    currency: fund.currencyCode,
    shareClass: fund.shareClass,
    asOfDate: fund.asOfDate,
    valuationStatus: fund.valuationStatus as LpFund["valuationStatus"],
    investorAccountReference: fund.investorAccountReference,
    commitmentAmount: fund.commitmentAmount,
  }
}

export function mapCapitalCallStatus(status: string): "Issued" | "Paid" | "Overdue" {
  const upper = status.toUpperCase()
  if (upper === "PAID") return "Paid"
  if (upper === "OVERDUE") return "Overdue"
  return "Issued"
}

export function mapCapitalCallRow(call: LpCapitalCall) {
  const days = daysUntil(call.dueDate)
  return {
    id: call.id,
    callNo: call.callNo,
    fund: call.fundName,
    fundId: call.fundId,
    issueDate: formatDate(call.issueDate),
    dueDate: formatDate(call.dueDate),
    amount: parseDecimal(call.amount),
    paid: parseDecimal(call.paid),
    outstanding: parseDecimal(call.outstanding),
    status: mapCapitalCallStatus(call.status),
    dueSoon: days >= 0 && days <= 7 && call.status.toUpperCase() !== "PAID",
    daysUntilDue: days,
    currencyCode: call.currencyCode,
    acknowledgedAt: call.acknowledgedAt,
  }
}

/** Show the type exactly as the API reports it (e.g. "Exit Proceeds", "Dividend"); never re-bucket it. */
export function mapDistributionType(type: string): string {
  const t = (type ?? "").trim()
  if (!t) return "Distribution"
  return t === t.toUpperCase() ? t.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : t
}

export function mapDistributionRow(dist: LpDistribution) {
  return {
    id: dist.id,
    ref: dist.reference,
    fund: dist.fundName,
    fundId: dist.fundId,
    type: mapDistributionType(dist.type),
    gross: parseDecimal(dist.gross),
    adjustments: parseDecimal(dist.adjustments),
    netPaid: parseDecimal(dist.netPaid),
    paymentDate: formatDate(dist.paymentDate),
    status: dist.status,
    documentId: dist.documentId,
    currencyCode: dist.currencyCode,
  }
}

export function mapDealingRequestRow(req: LpDealingRequest, fundNameLookup?: Record<string, string>) {
  return {
    id: req.id,
    type: req.requestType === "SUBSCRIPTION" ? ("Subscription" as const) : ("Redemption" as const),
    fund: req.fundName ?? fundNameLookup?.[req.fundId] ?? req.fundId,
    shareClass: req.shareClass ?? "—",
    amount: parseDecimal(req.amount),
    units: parseDecimal(req.units),
    unitsEstimated: req.isEstimate,
    status: titleCaseEnum(req.status) as
      | "Submitted"
      | "Awaiting Funds"
      | "Allocated"
      | "Under Review"
      | "Settled"
      | "Rejected",
    submittedOn: formatDate(req.createdAt),
    expectedSettlement: formatDate(req.requestedDealingDate),
  }
}

function mapStructureLabel(entry: LpAccountActivityEntry): "LP" | "Open-End" | "Credit" {
  const raw = (entry.structure ?? entry.operatingModel ?? "").toUpperCase()
  if (raw.includes("OPEN")) return "Open-End"
  if (raw.includes("CREDIT")) return "Credit"
  return "LP"
}

export function mapActivityEntryKind(entryType: string): "contribution" | "distribution" | "subscription" | "redemption" | "fee" {
  const t = entryType.toUpperCase()
  if (t.includes("DISTRIBUTION")) return "distribution"
  if (t.includes("SUBSCRIPTION")) return "subscription"
  if (t.includes("REDEMPTION")) return "redemption"
  if (t.includes("FEE")) return "fee"
  return "contribution"
}

export function mapAccountActivityRow(entry: LpAccountActivityEntry, investor = "") {
  return {
    id: entry.entryId,
    transactionDate: formatDate(entry.transactionDate),
    effectiveDate: formatDate(entry.transactionDate),
    fund: entry.fundName,
    fundId: entry.fundId,
    type: entry.description || titleCaseEnum(entry.entryType),
    kind: mapActivityEntryKind(entry.entryType),
    reference: entry.entryId,
    currency: entry.currency,
    originalAmount: parseDecimal(entry.amount),
    // BR-152: the API stamps the transaction-date rate; without one the original amount stays (never a silent conversion).
    reportingAmount: entry.reportingAmount != null ? parseDecimal(entry.reportingAmount) : parseDecimal(entry.amount),
    reportingCurrency: entry.reportingCurrency ?? entry.currency,
    exchangeRate: entry.fxRate != null ? Number(entry.fxRate) : 1,
    status: titleCaseEnum(entry.status) as
      | "Posted"
      | "Settled"
      | "Under Review"
      | "Pending",
    structure: mapStructureLabel(entry),
    investor,
    postedDate: formatDate(entry.transactionDate),
    postedBy: "System",
    notes: entry.description,
    documents: [] as Array<{ name: string; date: string; size: string }>,
    fxNote:
      entry.fxNote ??
      (entry.fxRate != null && Number(entry.fxRate) !== 1
        ? `Converted at ${Number(entry.fxRate).toFixed(4)} (rate of ${entry.fxRateDate ?? entry.transactionDate})`
        : "No FX required"),
  }
}

export function mapDocumentCategory(category: string): string {
  const map: Record<string, string> = {
    PERFORMANCE_REPORT: "Fund Reports",
    CALL_NOTICE: "Capital Calls",
    QUARTERLY_STATEMENT: "Statements",
    TAX: "Tax",
    LEGAL: "Legal",
    GOVERNANCE: "Governance",
    MANUAL: "Other",
    DISTRIBUTIONS: "Distributions",
  }
  return map[category] ?? titleCaseEnum(category)
}

export function mapDocumentRow(doc: LpDocument) {
  const mime = doc.mimeType?.toLowerCase() ?? ""
  const fileKind = mime.includes("sheet") || mime.includes("excel") ? ("xlsx" as const) : mime.includes("word") ? ("docx" as const) : ("pdf" as const)
  return {
    id: doc.id,
    title: doc.name,
    fileName: doc.name,
    fund: doc.fundName,
    fundId: doc.fundId,
    category: mapDocumentCategory(doc.category),
    period: doc.period ?? "—",
    publishedDate: formatDate(doc.publishedDate),
    publishedAt: doc.publishedDate,
    version: doc.version,
    accessScope: doc.accessScope.replace(/_/g, " "),
    status: titleCaseEnum(doc.status),
    fileKind,
    fileSize: formatFileSize(doc.fileSizeBytes),
    pages: doc.pageCount ?? 1,
    checksum: doc.checksumSha256,
    documentType: doc.category,
    permissions: doc.permissions,
    mimeType: doc.mimeType,
    history: (doc.history ?? []).map((h) => ({
      user: h.user,
      at: formatDate(h.at, "datetime"),
      ip: h.ip,
      action: h.action,
    })),
  }
}

const NOTICE_KIND_LABELS: Record<string, string> = {
  CAPITAL_CALL: "Capital Call",
  REPORT: "Report Available",
  REPORT_AVAILABLE: "Report Available",
  POLICY: "Policy Update",
  POLICY_UPDATE: "Policy Update",
  DISTRIBUTION: "Distribution",
  VALUATION: "Valuation Update",
  AGM: "AGM Notice",
}

export function mapNoticeKind(notice: LpNotice): string {
  const key = (notice.kind ?? notice.category ?? "POLICY").toUpperCase()
  return NOTICE_KIND_LABELS[key] ?? titleCaseEnum(key)
}

export function mapNoticeStatus(notice: LpNotice): "Unread" | "Opened" | "Acknowledged" {
  if (notice.acknowledgedAt) return "Acknowledged"
  if (notice.openedAt || notice.status.toUpperCase() === "OPENED") return "Opened"
  return "Unread"
}

export function mapNoticeRow(notice: LpNotice) {
  return {
    id: notice.id,
    title: notice.title,
    summary: notice.preview ?? notice.body?.slice(0, 120) ?? "",
    kind: mapNoticeKind(notice),
    fund: notice.fundName ?? notice.fundId,
    fundId: notice.fundId,
    audience: "Fund investors",
    publishedAt: formatDate(notice.publishedAt, "datetime"),
    publishedAtRaw: notice.publishedAt,
    status: mapNoticeStatus(notice),
    requiresAck: notice.requiresAcknowledgement ?? !notice.acknowledgedAt,
    body: notice.body ?? notice.preview ?? "",
  }
}

export function mapRequestPriority(priority?: string): "High" | "Medium" | "Low" {
  const p = (priority ?? "NORMAL").toUpperCase()
  if (p === "HIGH" || p === "URGENT") return "High"
  if (p === "LOW") return "Low"
  return "Medium"
}

export function mapRequestStatus(status: string): "Under Review" | "Awaiting Investor" | "Assigned" | "Submitted" | "Resolved" | "Closed" {
  const s = status.toUpperCase()
  if (s.includes("AWAITING") && s.includes("INVESTOR")) return "Awaiting Investor"
  if (s === "ASSIGNED") return "Assigned"
  if (s === "RESOLVED") return "Resolved"
  if (s === "CLOSED") return "Closed"
  if (s === "SUBMITTED") return "Submitted"
  return "Under Review"
}

export function mapServiceRequestRow(req: LpServiceRequest) {
  return {
    id: req.id,
    reference: req.reference,
    type: titleCaseEnum(req.type),
    apiType: req.type,
    fund: req.fundName,
    fundId: req.fundId,
    subject: req.subject,
    // The API returns `submittedBy` as `{ id, email, name }`, not a string — the declared type
    // said string and the mock supplied one, so this passed the object straight through to the
    // table cell and React threw "Objects are not valid as a React child", blanking the whole
    // Requests screen for any LP that actually has a request on file. Both shapes accepted.
    submittedBy:
      typeof req.submittedBy === "string"
        ? req.submittedBy
        : (req.submittedBy as { name?: string; email?: string } | null | undefined)?.name ??
          (req.submittedBy as { name?: string; email?: string } | null | undefined)?.email ??
          "You",
    lastUpdated: formatDate(req.updatedAt, "datetime"),
    status: mapRequestStatus(req.status),
    priority: mapRequestPriority(req.priority),
    linkedTo: req.fundName,
    description: req.description,
    attachments: (req.attachments ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      size: formatFileSize(a.size),
      downloadUrl: a.downloadUrl,
    })),
  }
}

export function mapMessageThreadRow(thread: LpMessageThreadSummary) {
  return {
    id: thread.id,
    requestId: thread.relatedId,
    title: thread.subject,
    fund: thread.fundName,
    fundId: thread.fundId,
    relatedType: thread.relatedType,
    relatedId: thread.relatedId,
    preview: thread.lastMessagePreview,
    updated: formatDate(thread.lastMessageAt, "datetime"),
    // The API returns unreadCount as a STRING ("0"/"1"), and the screen sums these with
    // `sum + (c.unread ?? 0)` — string concatenation, so a single thread rendered the badge
    // and tab as "00" rather than "0". Coerced at the boundary so the view model is numeric.
    unread: Number(thread.unreadCount ?? 0) || 0,
    linkedLabel: `${thread.relatedType} ${thread.relatedId}`,
    participants: [] as Array<{ name: string; initials: string; color: string }>,
    messages: [] as Array<{
      id: string
      sender: string
      initials: string
      role: "investor" | "team"
      timestamp: string
      body: string
      attachments?: Array<{ name: string; size: string; downloadUrl?: string }>
    }>,
  }
}

export function mapThreadParticipants(detail: LpMessageThreadDetail) {
  const colors = ["bg-[#dbeafe] text-[#1d4ed8]", "bg-[#ede9fe] text-[#6d28d9]", "bg-[#dcfce7] text-[#15803d]"]
  return (detail.participants ?? []).map((p, i) => ({
    name: p.name,
    initials: p.initials ?? p.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase(),
    color: colors[i % colors.length],
  }))
}

export function mapDashboardAction(action: LpDashboardAction, funds: LpFund[] = []) {
  const fundName = action.fundName ?? funds.find((f) => f.id === action.fundId)?.name ?? action.fundId
  return {
    title: action.title,
    fund: fundName,
    label: action.label ?? titleCaseEnum(action.type),
    amount: action.amount ? formatMoneyCompact(action.amount) : undefined,
    due: action.dueDate ? `Due ${formatDate(action.dueDate)}` : "",
    href: action.href,
    type: action.type,
    severity: action.severity,
  }
}

export function mapRecentActivityRow(item: LpRecentActivity) {
  return {
    id: item.id,
    label: item.title,
    amount: parseDecimal(item.amount),
    status: item.status,
    at: formatDate(item.at, "datetime"),
    type: item.type,
  }
}

export function mapHistoryChartPoint(point: LpPerformanceHistoryPoint) {
  return {
    label: point.label,
    nav: parseDecimal(point.nav) / 1_000_000,
    paidIn: parseDecimal(point.paidIn) / 1_000_000,
    dist: parseDecimal(point.distributions) / 1_000_000,
  }
}

export function mapOpenEndedHistoryPoint(point: LpOpenEndedHistoryPoint) {
  return {
    label: point.label,
    navPerUnit: parseDecimal(point.navPerUnit),
  }
}

export function mapCapitalCallDetail(call: LpCapitalCallDetail) {
  return {
    ...mapCapitalCallRow(call),
    wiring: call.wiring,
    timeline: call.timeline,
  }
}

export function mapPerformanceStructure(row: { structure?: string; operatingModel?: string }): string {
  const raw = (row.structure ?? row.operatingModel ?? "").toUpperCase()
  if (raw.includes("OPEN")) return "Open-End"
  if (raw.includes("CREDIT")) return "Credit"
  if (raw.includes("PRIVATE") || raw.includes("CLOSED")) return "Closed-End"
  return row.structure ?? row.operatingModel ?? "—"
}

export const API_DOC_CATEGORY: Record<string, string> = {
  Statements: "QUARTERLY_STATEMENT",
  "Capital Calls": "CALL_NOTICE",
  Distributions: "DISTRIBUTIONS",
  Other: "MANUAL",
  "Fund Reports": "PERFORMANCE_REPORT",
  Tax: "TAX",
  Legal: "LEGAL",
  Governance: "GOVERNANCE",
}
