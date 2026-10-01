/**
 * Offline LP Portal API — implements the same surface as `LpPortalApiService`
 * against the in-memory mock store.
 */

import type {
  LpAccountActivityEntry,
  LpBankAccount,
  LpBankInstructionChange,
  LpBenchmarkSeries,
  LpCapitalCall,
  LpCapitalCallDetail,
  LpCapitalCallDocument,
  LpCapitalCallSummary,
  LpColleague,
  LpDashboardAction,
  LpDashboardData,
  LpDealingCompliance,
  LpDealingOverview,
  LpDealingRequest,
  LpDealingRules,
  LpDisplaySettings,
  LpDistribution,
  LpDocument,
  LpDocumentsSummary,
  LpJobStatus,
  LpLedgerDetail,
  LpLedgerEntry,
  LpListData,
  LpMessageThreadDetail,
  LpMessageThreadSummary,
  LpNotice,
  LpNotificationItem,
  LpNotificationPreferences,
  LpOrganisation,
  LpPerformanceByFundRow,
  LpPerformanceData,
  LpPerformanceHistory,
  LpPortalResponse,
  LpRealtimeInfo,
  LpRedemptionEstimate,
  LpReport,
  LpReportsPagination,
  LpRequestAttachment,
  LpServiceRequest,
  LpSession,
  LpSettings,
  LpSubscriptionEstimate,
  LpVaultDocument,
  LpVaultVerifyResult,
} from "@/lib/api/lp-portal-api"
import {
  acknowledgeCall,
  acknowledgeNotice as storeAcknowledgeNotice,
  addAttachment,
  addBankInstructionChange,
  addDealingRequest,
  addRequest,
  addRequestMessage,
  addThreadMessage,
  createJob,
  estimateRedemption as storeEstimateRedemption,
  estimateSubscription as storeEstimateSubscription,
  getMockStore,
  inviteColleague as storeInviteColleague,
  markThreadRead,
  MOCK_FUND_IDS,
  paginate,
  revokeColleague as storeRevokeColleague,
  threadSummaries,
  updateColleague as storeUpdateColleague,
  updateDisplaySettings as storeUpdateDisplaySettings,
  updateNotificationSettings as storeUpdateNotificationSettings,
} from "@/lib/lp-portal/mock-store"

const { GROWTH, EQUITY, AS_OF } = MOCK_FUND_IDS

const MOCK_PDF = new Blob(["Mock LP Portal file"], { type: "application/pdf" })

function delay(ms = 80): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function ok<T>(data: T): LpPortalResponse<T> {
  return {
    success: true,
    data,
    timestamp: new Date().toISOString(),
    meta: { requestId: `mock-${Date.now()}` },
  }
}

function mockPdfBlob(_id?: string): Blob {
  return new Blob(["Mock LP Portal file"], { type: "application/pdf" })
}

function mockPreviewBlob(id: string): Blob {
  const doc = getMockStore().documents.find((d) => d.id === id)
  const title = doc?.name ?? id
  const html = `<!DOCTYPE html><html><head><title>${title}</title></head><body style="font-family:system-ui;padding:2rem"><h1>${title}</h1><p>Mock LP Portal document preview.</p><p>Document id: ${id}</p></body></html>`
  return new Blob([html], { type: "text/html" })
}

function filterByFund<T extends { fundId?: string | null }>(items: T[], fundId?: string): T[] {
  if (!fundId) return items
  return items.filter((item) => item.fundId === fundId || item.fundId == null)
}

function listPage<T>(items: T[], page?: number, pageSize?: number): LpListData<T> {
  return paginate(items, page ?? 1, pageSize ?? 20)
}

function resolveFundKey(fundId?: string): string {
  if (fundId && getMockStore().dashboards[fundId]) return fundId
  return GROWTH
}

/** Mixed-portfolio consolidated dashboard: private-capital KPIs + open-ended side panel. */
function attachOpenEndedForMixedPortfolio(dash: LpDashboardData): LpDashboardData {
  if (dash.openEndedSummary) return dash
  const store = getMockStore()
  for (const fund of store.session.funds) {
    if (fund.operatingModel !== "OPEN_ENDED") continue
    const openEndedDash = store.dashboards[fund.fundId]
    if (!openEndedDash?.openEndedSummary) continue
    dash.openEndedSummary = structuredClone(openEndedDash.openEndedSummary)
    dash.openEndedHistory = structuredClone(openEndedDash.openEndedHistory)
    break
  }
  return dash
}

function formDataToRecord(body: FormData | Record<string, unknown>): Record<string, unknown> {
  if (!(body instanceof FormData)) return { ...body }
  const out: Record<string, unknown> = {}
  body.forEach((value, key) => {
    if (typeof value === "string") out[key] = value
  })
  return out
}

export const mockLpPortalApi = {
  async getSession(): Promise<LpPortalResponse<LpSession>> {
    await delay()
    return ok(structuredClone(getMockStore().session))
  },

  async getDashboard(params: {
    fundId?: string
    asOfDate?: string
    presentationCurrency?: string
  } = {}): Promise<LpPortalResponse<LpDashboardData>> {
    await delay()
    const key = resolveFundKey(params.fundId)
    const dash = structuredClone(getMockStore().dashboards[key] ?? getMockStore().dashboards[GROWTH])
    if (!params.fundId) attachOpenEndedForMixedPortfolio(dash)
    return ok(dash)
  },

  async getDashboardActions(): Promise<LpPortalResponse<{ items: LpDashboardAction[] }>> {
    await delay()
    return ok({ items: structuredClone(getMockStore().dashboardActions) })
  },

  async getDashboardRecentActivity(limit = 10): Promise<LpPortalResponse<{ items: Array<{
    id: string
    type: string
    title: string
    fundId: string
    amount: string
    status: string
    at: string
  }> }>> {
    await delay()
    return ok({ items: structuredClone(getMockStore().recentActivity.slice(0, limit)) })
  },

  async getRealtime(): Promise<LpPortalResponse<LpRealtimeInfo>> {
    await delay()
    return ok({
      enabled: false,
      pollingIntervalMs: 30000,
      events: [],
    })
  },

  async getNotifications(limit = 10): Promise<LpPortalResponse<{ items: LpNotificationItem[] }>> {
    await delay()
    return ok({ items: structuredClone(getMockStore().notifications.slice(0, limit)) })
  },

  async getCapitalCalls(params: {
    fundId?: string
    status?: string
    page?: number
    pageSize?: number
  } = {}): Promise<LpPortalResponse<LpListData<LpCapitalCall>>> {
    await delay()
    let items = filterByFund(getMockStore().capitalCalls, params.fundId)
    if (params.status) items = items.filter((c) => c.status === params.status)
    const page = listPage(items, params.page, params.pageSize)
    return ok({
      ...page,
      items: page.items.map(({ wiring: _w, timeline: _t, ...call }) => call),
    })
  },

  async getCapitalCall(id: string): Promise<LpPortalResponse<LpCapitalCallDetail>> {
    await delay()
    const call = getMockStore().capitalCalls.find((c) => c.id === id)
    if (!call) throw new Error(`Capital call not found: ${id}`)
    return ok(structuredClone(call))
  },

  async getCapitalCallSummary(fundId?: string): Promise<LpPortalResponse<LpCapitalCallSummary>> {
    await delay()
    const key = fundId && getMockStore().capitalCallSummaries[fundId] ? fundId : GROWTH
    return ok(structuredClone(getMockStore().capitalCallSummaries[key]))
  },

  async getCapitalCallDocuments(id: string): Promise<LpPortalResponse<LpCapitalCallDocument[]>> {
    await delay()
    const docs = getMockStore().capitalCallDocuments[id] ?? []
    return ok(structuredClone(docs))
  },

  async acknowledgeCapitalCall(
    id: string,
    _idempotencyKey?: string,
  ): Promise<LpPortalResponse<{ acknowledgedAt: string }>> {
    await delay()
    return ok(acknowledgeCall(id))
  },

  async uploadPaymentConfirmation(
    id: string,
    formData: FormData,
    _idempotencyKey?: string,
  ): Promise<
    LpPortalResponse<{
      id: string
      fileName: string
      sha256: string
      amountClaimed: string
      uploadedAt: string
    }>
  > {
    await delay()
    const file = formData.get("file")
    const fileName =
      file instanceof File ? file.name : String(formData.get("fileName") ?? "payment-confirmation.pdf")
    const amountClaimed = String(formData.get("amountClaimed") ?? formData.get("amount") ?? "0")
    const call = getMockStore().capitalCalls.find((c) => c.id === id)
    return ok({
      id: `pay-conf-${Date.now()}`,
      fileName,
      sha256: "mocksha256paymentconfirmation00000000000000000000000000000000",
      amountClaimed: amountClaimed || call?.outstanding || "0",
      uploadedAt: new Date().toISOString(),
    })
  },

  async downloadCapitalCallNotice(_id: string): Promise<Blob> {
    await delay()
    return mockPdfBlob()
  },

  async getDistributions(params: {
    fundId?: string
    page?: number
    pageSize?: number
  } = {}): Promise<LpPortalResponse<LpListData<LpDistribution>>> {
    await delay()
    const items = filterByFund(getMockStore().distributions, params.fundId)
    return ok(listPage(items, params.page, params.pageSize))
  },

  async getDistribution(id: string): Promise<LpPortalResponse<LpDistribution>> {
    await delay()
    const dist = getMockStore().distributions.find((d) => d.id === id)
    if (!dist) throw new Error(`Distribution not found: ${id}`)
    return ok(structuredClone(dist))
  },

  async downloadDistribution(_id: string): Promise<Blob> {
    await delay()
    return mockPdfBlob()
  },

  async downloadDistributionStatement(_params: {
    fundId?: string
    asOfDate?: string
  }): Promise<Blob> {
    await delay()
    return mockPdfBlob()
  },

  async getAccountActivity(params: {
    fundId?: string
    from?: string
    to?: string
    currency?: string
    page?: number
    pageSize?: number
  } = {}): Promise<LpPortalResponse<LpListData<LpAccountActivityEntry>>> {
    await delay()
    let items = filterByFund(getMockStore().accountActivity, params.fundId)
    if (params.currency) items = items.filter((e) => e.currency === params.currency)
    if (params.from) items = items.filter((e) => e.transactionDate >= params.from!)
    if (params.to) items = items.filter((e) => e.transactionDate <= params.to!)
    return ok(listPage(items, params.page, params.pageSize))
  },

  async exportAccountActivity(_params: {
    fundId?: string
    from?: string
    to?: string
    format?: "csv" | "xlsx" | "pdf"
  }): Promise<Blob> {
    await delay()
    const format = _params.format ?? "csv"
    if (format === "csv") {
      return new Blob(["entryId,fundId,amount,date\nmock,growth-fund-i,0,2026-06-30\n"], {
        type: "text/csv",
      })
    }
    return mockPdfBlob()
  },

  async getLedger(params: {
    fundId?: string
    from?: string
    to?: string
    currency?: string
  } = {}): Promise<LpPortalResponse<LpLedgerEntry[]>> {
    await delay()
    let items = filterByFund(getMockStore().accountActivity, params.fundId) as LpLedgerEntry[]
    if (params.currency) items = items.filter((e) => e.currency === params.currency)
    if (params.from) items = items.filter((e) => e.transactionDate >= params.from!)
    if (params.to) items = items.filter((e) => e.transactionDate <= params.to!)
    return ok(structuredClone(items))
  },

  async getLedgerEntry(entryId: string): Promise<LpPortalResponse<LpLedgerDetail>> {
    await delay()
    const detail = getMockStore().ledgerDetails[entryId]
    if (!detail) {
      return ok({ entryType: "OTHER", payments: [], documents: [] })
    }
    return ok(structuredClone(detail))
  },

  async getDealingBankAccounts(fundId?: string): Promise<LpPortalResponse<LpBankAccount[]>> {
    await delay()
    const items = filterByFund(getMockStore().bankAccounts, fundId)
    return ok(structuredClone(items))
  },

  async getDealingOverview(fundId: string): Promise<LpPortalResponse<LpDealingOverview>> {
    await delay()
    const overview =
      getMockStore().dealingOverviews[fundId] ?? getMockStore().dealingOverviews[EQUITY]
    return ok(structuredClone(overview))
  },

  async getDealingRules(
    fundId: string,
  ): Promise<LpPortalResponse<LpDealingRules & { fundId: string; compliance: LpDealingCompliance }>> {
    await delay()
    const overview =
      getMockStore().dealingOverviews[fundId] ?? getMockStore().dealingOverviews[EQUITY]
    return ok({
      ...structuredClone(overview.rules),
      fundId,
      compliance: structuredClone(overview.compliance),
    })
  },

  async getDealingRequests(params: {
    fundId?: string
    type?: "SUBSCRIPTION" | "REDEMPTION"
    page?: number
    pageSize?: number
  } = {}): Promise<LpPortalResponse<LpListData<LpDealingRequest>>> {
    await delay()
    let items = filterByFund(getMockStore().dealingRequests, params.fundId)
    if (params.type) items = items.filter((r) => r.requestType === params.type)
    return ok(listPage(items, params.page, params.pageSize))
  },

  async exportDealingRequests(_params: {
    fundId?: string
    type?: "SUBSCRIPTION" | "REDEMPTION"
    format?: "csv" | "xlsx"
  } = {}): Promise<Blob> {
    await delay()
    return new Blob(["id,type,status,amount\ndeal-001,SUBSCRIPTION,ALLOCATED,500000\n"], {
      type: "text/csv",
    })
  },

  async estimateSubscription(body: {
    fundId: string
    shareClass: string
    amount: string
    currency: string
  }): Promise<LpPortalResponse<LpSubscriptionEstimate>> {
    await delay()
    return ok(storeEstimateSubscription(body))
  },

  async submitSubscription(
    body: Record<string, unknown> | FormData,
    _idempotencyKey?: string,
  ): Promise<LpPortalResponse<LpDealingRequest>> {
    await delay()
    const data = formDataToRecord(body)
    const fundId = String(data.fundId ?? EQUITY)
    const fund = getMockStore().session.funds.find((f) => f.fundId === fundId)
    const amount = String(data.amount ?? "0")
    const estimateSnapshotId = String(data.estimateSnapshotId ?? `est-sub-${Date.now()}`)
    const req = addDealingRequest({
      fundId,
      fundName: fund?.fundName,
      shareClass: String(data.shareClass ?? fund?.shareClass ?? "Class A USD"),
      requestType: "SUBSCRIPTION",
      status: "SUBMITTED",
      amount,
      units: String(data.estimatedUnits ?? "0"),
      redemptionMode: null,
      currencyCode: String(data.currency ?? "USD"),
      requestedDealingDate: String(
        data.requestedDealingDate ??
          getMockStore().dealingOverviews[fundId]?.rules.nextEligibleDealingDate ??
          "2026-08-01",
      ),
      estimateSnapshotId,
      isEstimate: false,
      notes: data.notes != null ? String(data.notes) : null,
    })
    return ok(structuredClone(req))
  },

  async estimateRedemption(body: {
    fundId: string
    shareClass: string
    mode: "AMOUNT" | "UNITS" | "FULL"
    amount?: string
    units?: string
    full?: boolean
    earliestDealingDate: string
  }): Promise<LpPortalResponse<LpRedemptionEstimate>> {
    await delay()
    return ok(storeEstimateRedemption(body))
  },

  async submitRedemption(
    body: Record<string, unknown>,
    _idempotencyKey?: string,
  ): Promise<LpPortalResponse<LpDealingRequest>> {
    await delay()
    const fundId = String(body.fundId ?? EQUITY)
    const fund = getMockStore().session.funds.find((f) => f.fundId === fundId)
    const mode = String(body.mode ?? "AMOUNT").toUpperCase()
    const req = addDealingRequest({
      fundId,
      fundName: fund?.fundName,
      shareClass: String(body.shareClass ?? fund?.shareClass ?? "Class A USD"),
      requestType: "REDEMPTION",
      status: "SUBMITTED",
      amount: String(body.amount ?? "0"),
      units: String(body.units ?? "0"),
      redemptionMode: mode,
      currencyCode: String(body.currency ?? "USD"),
      requestedDealingDate: String(body.earliestDealingDate ?? "2026-08-01"),
      estimateSnapshotId: String(body.estimateSnapshotId ?? `est-rdm-${Date.now()}`),
      isEstimate: false,
      notes: body.notes != null ? String(body.notes) : null,
    })
    return ok(structuredClone(req))
  },

  async getPerformance(params: {
    fundId?: string
    period?: string
    asOfDate?: string
  } = {}): Promise<LpPortalResponse<LpPerformanceData>> {
    await delay()
    const key = resolveFundKey(params.fundId)
    const perf = structuredClone(getMockStore().performance[key] ?? getMockStore().performance[GROWTH])
    if (params.period) perf.period = params.period
    if (params.asOfDate) perf.asOfDate = params.asOfDate
    return ok(perf)
  },

  async getPerformanceHistory(params: {
    fundId?: string
    period?: string
  }): Promise<LpPortalResponse<LpPerformanceHistory>> {
    await delay()
    const key = resolveFundKey(params.fundId)
    const hist = structuredClone(
      getMockStore().performanceHistory[key] ?? getMockStore().performanceHistory[GROWTH],
    )
    if (params.period) hist.range = params.period
    return ok(hist)
  },

  async getPerformanceByFund(
    asOfDate?: string,
  ): Promise<
    LpPortalResponse<{ asOfDate: string; valuationStatus: string; funds: LpPerformanceByFundRow[] }>
  > {
    await delay()
    return ok({
      asOfDate: asOfDate ?? AS_OF,
      valuationStatus: "FINAL",
      funds: structuredClone(getMockStore().performanceByFundRows),
    })
  },

  async getPerformanceBenchmarks(params: {
    fundId?: string
    metric?: string
    benchmarkId?: string
  } = {}): Promise<LpPortalResponse<LpBenchmarkSeries>> {
    await delay()
    const key = resolveFundKey(params.fundId)
    const series = structuredClone(
      getMockStore().benchmarks[key] ?? getMockStore().benchmarks[GROWTH],
    )
    if (params.metric) series.metric = params.metric
    return ok(series)
  },

  async requestPerformanceReport(
    body: { fundId?: string; asOfDate?: string; period?: string },
    _idempotencyKey?: string,
  ): Promise<LpPortalResponse<{ jobId: string; status: string; createdAt: string }>> {
    await delay()
    const job = createJob("PERFORMANCE_REPORT")
    return ok({ jobId: job.jobId, status: job.status, createdAt: job.createdAt })
  },

  async getJob(jobId: string): Promise<LpPortalResponse<LpJobStatus>> {
    await delay()
    const existing = getMockStore().jobs[jobId]
    if (existing) return ok(structuredClone(existing))
    const job: LpJobStatus = {
      jobId,
      jobType: "REPORT",
      status: "COMPLETED",
      downloadUrl: `/mock/reports/${jobId}.pdf`,
      errorMessage: null,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    }
    getMockStore().jobs[jobId] = job
    return ok(job)
  },

  async downloadPerformanceReport(params: {
    fundId?: string
  }): Promise<LpPortalResponse<{ jobId: string; status: string; createdAt: string }>> {
    await delay()
    const job = createJob(`PERFORMANCE_REPORT_${params.fundId ?? "all"}`)
    return ok({ jobId: job.jobId, status: job.status, createdAt: job.createdAt })
  },

  async getDocuments(params: {
    category?: string
    fundId?: string
    q?: string
    page?: number
    pageSize?: number
  } = {}): Promise<LpPortalResponse<LpListData<LpDocument>>> {
    await delay()
    let items = filterByFund(getMockStore().documents, params.fundId)
    if (params.category) {
      const cat = params.category.toLowerCase()
      items = items.filter((d) => d.category.toLowerCase().includes(cat))
    }
    if (params.q) {
      const q = params.q.toLowerCase()
      items = items.filter(
        (d) =>
          d.name.toLowerCase().includes(q) ||
          d.category.toLowerCase().includes(q) ||
          d.fundName.toLowerCase().includes(q),
      )
    }
    return ok(listPage(items, params.page, params.pageSize))
  },

  async getDocumentsSummary(): Promise<LpPortalResponse<LpDocumentsSummary>> {
    await delay()
    return ok(structuredClone(getMockStore().documentsSummary))
  },

  async getDocument(id: string): Promise<LpPortalResponse<LpDocument>> {
    await delay()
    const doc = getMockStore().documents.find((d) => d.id === id)
    if (!doc) throw new Error(`Document not found: ${id}`)
    return ok(structuredClone(doc))
  },

  async downloadDocument(_id: string): Promise<Blob> {
    await delay()
    return mockPdfBlob()
  },

  async previewDocument(id: string): Promise<Blob> {
    await delay()
    const doc = getMockStore().documents.find((d) => d.id === id)
    if (doc?.mimeType === "application/pdf") return mockPdfBlob()
    return mockPreviewBlob(id)
  },

  async getVault(
    // Slice historically passes a category string; live client expects an object.
    params: string | { category?: string; fundId?: string; search?: string } = {},
  ): Promise<LpPortalResponse<LpVaultDocument[]>> {
    await delay()
    const normalized =
      typeof params === "string" || params == null
        ? { category: params || undefined }
        : params
    let items = [...getMockStore().vault]
    if (normalized.fundId) items = items.filter((v) => v.fundId === normalized.fundId)
    if (normalized.category) items = items.filter((v) => v.category === normalized.category)
    if (normalized.search) {
      const q = normalized.search.toLowerCase()
      items = items.filter(
        (v) => v.title.toLowerCase().includes(q) || v.fundName.toLowerCase().includes(q),
      )
    }
    return ok(structuredClone(items))
  },

  async downloadVaultDocument(_documentId: string): Promise<Blob> {
    await delay()
    return mockPdfBlob()
  },

  async verifyVaultDocument(documentId: string): Promise<LpPortalResponse<LpVaultVerifyResult>> {
    await delay()
    const doc = getMockStore().vault.find((v) => v.documentId === documentId)
    const sha = doc?.sha256 ?? "mocksha2560000000000000000000000000000000000000000000000000000"
    return ok({
      documentId,
      verified: true,
      expectedSha256: sha,
      actualSha256: sha,
    })
  },

  async getNotices(
    params: { page?: number; pageSize?: number } = {},
  ): Promise<LpPortalResponse<LpListData<LpNotice>>> {
    await delay()
    return ok(listPage(getMockStore().notices, params.page, params.pageSize))
  },

  async getNotice(id: string): Promise<LpPortalResponse<LpNotice>> {
    await delay()
    const notice = getMockStore().notices.find((n) => n.id === id)
    if (!notice) throw new Error(`Notice not found: ${id}`)
    if (!notice.openedAt) notice.openedAt = new Date().toISOString()
    return ok(structuredClone(notice))
  },

  async acknowledgeNotice(
    id: string,
    _idempotencyKey?: string,
  ): Promise<LpPortalResponse<{ acknowledgedAt: string }>> {
    await delay()
    return ok(storeAcknowledgeNotice(id))
  },

  async getRequests(
    params: { status?: string; page?: number; pageSize?: number } = {},
  ): Promise<LpPortalResponse<LpListData<LpServiceRequest>>> {
    await delay()
    let items = [...getMockStore().requests]
    if (params.status) items = items.filter((r) => r.status === params.status)
    return ok(listPage(items, params.page, params.pageSize))
  },

  async getRequest(reference: string): Promise<LpPortalResponse<LpServiceRequest>> {
    await delay()
    const req = getMockStore().requests.find(
      (r) => r.reference === reference || r.id === reference,
    )
    if (!req) throw new Error(`Request not found: ${reference}`)
    return ok(structuredClone(req))
  },

  async createRequest(
    body: {
      type: string
      fundId?: string
      subject: string
      description: string
      priority?: string
      attachmentIds?: string[]
    },
    _idempotencyKey?: string,
  ): Promise<LpPortalResponse<LpServiceRequest>> {
    await delay()
    return ok(structuredClone(addRequest(body)))
  },

  async uploadRequestAttachment(
    formData: FormData,
    _idempotencyKey?: string,
  ): Promise<LpPortalResponse<LpRequestAttachment>> {
    await delay()
    const file = formData.get("file")
    const name = file instanceof File ? file.name : String(formData.get("name") ?? "attachment.bin")
    const size = file instanceof File ? file.size : Number(formData.get("size") ?? 1024)
    return ok(addAttachment(name, size))
  },

  async replyToRequest(
    reference: string,
    body: { body: string; attachmentIds?: string[] },
  ): Promise<LpPortalResponse<{ id: string; authorType: string; body: string; createdAt: string }>> {
    await delay()
    return ok(addRequestMessage(reference, body.body, body.attachmentIds))
  },

  async getMessages(
    params: { page?: number; pageSize?: number } = {},
  ): Promise<LpPortalResponse<LpListData<LpMessageThreadSummary>>> {
    await delay()
    return ok(listPage(threadSummaries(), params.page, params.pageSize))
  },

  async getMessageThread(id: string): Promise<LpPortalResponse<LpMessageThreadDetail>> {
    await delay()
    const thread = getMockStore().messageThreads.find((t) => t.id === id)
    if (!thread) throw new Error(`Message thread not found: ${id}`)
    return ok(structuredClone(thread))
  },

  async markMessageThreadRead(
    id: string,
  ): Promise<LpPortalResponse<{ threadId: string; markedRead: number }>> {
    await delay()
    return ok(markThreadRead(id))
  },

  async replyToMessageThread(
    id: string,
    body: { body: string; attachmentIds?: string[] },
  ): Promise<LpPortalResponse<{ id: string; authorType: string; body: string; createdAt: string }>> {
    await delay()
    return ok(addThreadMessage(id, body.body, body.attachmentIds))
  },

  async getOrganisation(): Promise<LpPortalResponse<LpOrganisation>> {
    await delay()
    return ok(structuredClone(getMockStore().organisation))
  },

  async getColleagues(): Promise<LpPortalResponse<LpColleague[]>> {
    await delay()
    return ok(structuredClone(getMockStore().organisation.colleagues))
  },

  async inviteColleague(
    body: { email: string; role: string; fundIds: string[] },
    _idempotencyKey?: string,
  ): Promise<
    LpPortalResponse<{
      id: string
      userId: string
      clientId: string
      lpRole: string
      fundIds: string[]
      isActive: boolean
      invitedById: string
    }>
  > {
    await delay()
    return ok(storeInviteColleague(body))
  },

  async updateColleague(
    membershipId: string,
    body: { role?: string; fundIds?: string[] },
  ): Promise<
    LpPortalResponse<{
      id: string
      userId: string
      clientId: string
      lpRole: string
      fundIds: string[]
      isActive: boolean
    }>
  > {
    await delay()
    return ok(storeUpdateColleague(membershipId, body))
  },

  async revokeColleague(
    membershipId: string,
  ): Promise<LpPortalResponse<{ membershipId: string; userId: string; revokedById: string }>> {
    await delay()
    return ok(storeRevokeColleague(membershipId))
  },

  async getBankInstructionChanges(): Promise<LpPortalResponse<LpBankInstructionChange[]>> {
    await delay()
    return ok(structuredClone(getMockStore().bankChanges))
  },

  async submitBankInstructionChange(
    body: Record<string, unknown>,
    _idempotencyKey?: string,
  ): Promise<LpPortalResponse<LpBankInstructionChange>> {
    await delay()
    return ok(structuredClone(addBankInstructionChange(body)))
  },

  async getSettings(): Promise<LpPortalResponse<LpSettings>> {
    await delay()
    return ok(structuredClone(getMockStore().settings))
  },

  async getMfaSettings(): Promise<LpPortalResponse<LpSettings["mfa"]>> {
    await delay()
    return ok(structuredClone(getMockStore().settings.mfa))
  },

  async updateNotificationSettings(
    body: Partial<LpNotificationPreferences>,
  ): Promise<LpPortalResponse<LpNotificationPreferences>> {
    await delay()
    return ok(storeUpdateNotificationSettings(body))
  },

  async updateDisplaySettings(
    body: LpDisplaySettings,
  ): Promise<LpPortalResponse<LpDisplaySettings>> {
    await delay()
    return ok(storeUpdateDisplaySettings(body))
  },

  async getReports(
    params: { fundId?: string; page?: number; limit?: number } = {},
  ): Promise<LpPortalResponse<{ data: LpReport[]; pagination: LpReportsPagination }>> {
    await delay()
    let items = [...getMockStore().reports]
    if (params.fundId) {
      items = items.filter((r) => r.metrics.fundId === params.fundId)
    }
    const page = params.page ?? 1
    const limit = params.limit ?? 20
    const paged = paginate(items, page, limit)
    return ok({
      data: paged.items,
      pagination: {
        page: paged.page,
        limit: paged.pageSize,
        total: paged.total,
        pages: paged.totalPages,
      },
    })
  },

  async downloadReport(_jobId: string): Promise<Blob> {
    await delay()
    return MOCK_PDF
  },
}
