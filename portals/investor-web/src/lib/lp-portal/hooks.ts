"use client"

import * as React from "react"
import { lpPortalApi } from "@/lib/api/lp-portal-api"
import {
  mapAccountActivityRow,
  mapCapitalCallRow,
  mapDealingRequestRow,
  mapDistributionRow,
  mapDocumentRow,
  mapMessageThreadRow,
  mapNoticeRow,
  mapServiceRequestRow,
} from "@/lib/lp-portal/mappers"
import { getApiErrorMessage } from "@/lib/lp-portal/use-lp-api"
import { useLpFundScope, useLpPortal } from "@/components/lp-portal/lp-portal-context"

export function useAsyncData<T>(
  fetcher: () => Promise<T>,
  deps: React.DependencyList,
  enabled = true,
) {
  const [data, setData] = React.useState<T | null>(null)
  const [loading, setLoading] = React.useState(enabled)
  const [error, setError] = React.useState<string | null>(null)

  const reload = React.useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    setError(null)
    try {
      setData(await fetcher())
    } catch (err) {
      setError(getApiErrorMessage(err))
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [enabled, ...deps])

  React.useEffect(() => {
    void reload()
  }, [reload])

  return { data, loading, error, reload, setData }
}

export function useLpDashboardBundle() {
  const { fundId, asOfDate, presentationCurrency } = useLpFundScope()
  const { refreshKeys } = useLpPortal()
  return useAsyncData(
    async () => {
      const [dashboard, actions, activity, history] = await Promise.all([
        lpPortalApi.getDashboard({ fundId, asOfDate, presentationCurrency }),
        lpPortalApi.getDashboardActions(),
        lpPortalApi.getDashboardRecentActivity(10),
        lpPortalApi.getPerformanceHistory({ fundId, period: "SI" }),
      ])
      return {
        dashboard: dashboard.data,
        actions: actions.data.items,
        activity: activity.data.items,
        history: history.data.points,
        openEndedHistory: dashboard.data.openEndedHistory?.points ?? [],
      }
    },
    [fundId, asOfDate, presentationCurrency, refreshKeys.dashboard],
  )
}

export function useLpCapitalCalls() {
  const { fundId } = useLpFundScope()
  const { refreshKeys } = useLpPortal()
  return useAsyncData(
    async () => {
      const [list, summary] = await Promise.all([
        lpPortalApi.getCapitalCalls({ fundId, pageSize: 50 }),
        lpPortalApi.getCapitalCallSummary(fundId),
      ])
      return {
        calls: list.data.items.map(mapCapitalCallRow),
        summary: summary.data,
        total: list.data.total,
      }
    },
    [fundId, refreshKeys.capital],
  )
}

export function useLpCapitalCallDetail(callId: string | null) {
  return useAsyncData(
    async () => {
      if (!callId) return null
      const [detail, documents] = await Promise.all([
        lpPortalApi.getCapitalCall(callId),
        lpPortalApi.getCapitalCallDocuments(callId),
      ])
      return { detail: detail.data, documents: documents.data }
    },
    [callId],
    Boolean(callId),
  )
}

export function useLpDistributions() {
  const { fundId } = useLpFundScope()
  const { refreshKeys } = useLpPortal()
  return useAsyncData(
    async () => {
      const res = await lpPortalApi.getDistributions({ fundId, pageSize: 50 })
      return { items: res.data.items.map(mapDistributionRow), total: res.data.total }
    },
    [fundId, refreshKeys.capital],
  )
}

export function useLpDealingOverview(fundIdOverride?: string) {
  const { selectedFundId, funds, refreshKeys } = useLpPortal()
  const fundId =
    fundIdOverride ??
    (selectedFundId && selectedFundId !== "all"
      ? selectedFundId
      : funds.find((f) => f.operatingModel === "OPEN_ENDED")?.id)
  const fundLookup = React.useMemo(
    () => Object.fromEntries(funds.map((f) => [f.id, f.name])),
    [funds],
  )
  return useAsyncData(
    async () => {
      if (!fundId) return null
      const [overview, banks, requests] = await Promise.all([
        lpPortalApi.getDealingOverview(fundId),
        lpPortalApi.getDealingBankAccounts(fundId),
        lpPortalApi.getDealingRequests({ fundId, pageSize: 50 }),
      ])
      return {
        overview: overview.data,
        banks: banks.data,
        requests: requests.data.items.map((r) => mapDealingRequestRow(r, fundLookup)),
      }
    },
    [fundId, fundLookup, refreshKeys.dealing],
    Boolean(fundId),
  )
}

export function useLpPerformanceBundle(period = "SI", benchmarkId?: string) {
  const { fundId, asOfDate } = useLpFundScope()
  const { refreshKeys } = useLpPortal()
  return useAsyncData(
    async () => {
      const [performance, history, byFund, benchmarks] = await Promise.all([
        lpPortalApi.getPerformance({ fundId, period, asOfDate }),
        lpPortalApi.getPerformanceHistory({ fundId, period }),
        lpPortalApi.getPerformanceByFund(asOfDate),
        lpPortalApi.getPerformanceBenchmarks({ fundId, metric: "NET_IRR", benchmarkId }),
      ])
      return {
        performance: performance.data,
        history: history.data.points,
        byFund: byFund.data.funds,
        benchmarks: benchmarks.data,
      }
    },
    [fundId, asOfDate, period, benchmarkId, refreshKeys.performance],
  )
}

export function useLpAccountActivity(fromDate?: string) {
  const { fundId, asOfDate } = useLpFundScope()
  const { client, refreshKeys } = useLpPortal()
  return useAsyncData(
    async () => {
      const res = await lpPortalApi.getAccountActivity({
        fundId,
        from: fromDate,
        to: asOfDate,
        pageSize: 100,
      })
      return {
        items: res.data.items.map((e) => mapAccountActivityRow(e, client?.legalName ?? "")),
        total: res.data.total,
      }
    },
    [fundId, asOfDate, fromDate, client?.legalName, refreshKeys.activity],
  )
}

export function useLpDocuments(params: { category?: string; q?: string; page?: number } = {}) {
  const { fundId } = useLpFundScope()
  const { refreshKeys } = useLpPortal()
  return useAsyncData(
    async () => {
      const [list, summary] = await Promise.all([
        lpPortalApi.getDocuments({
          fundId,
          category: params.category,
          q: params.q,
          page: params.page ?? 1,
          pageSize: 20,
        }),
        lpPortalApi.getDocumentsSummary(),
      ])
      return {
        items: list.data.items.map(mapDocumentRow),
        total: list.data.total,
        page: list.data.page,
        totalPages: list.data.totalPages,
        summary: summary.data,
      }
    },
    [fundId, params.category, params.q, params.page, refreshKeys.documents],
  )
}

export function useLpNotices() {
  const { refreshKeys } = useLpPortal()
  return useAsyncData(async () => {
    const res = await lpPortalApi.getNotices({ pageSize: 50 })
    return (res.data?.items ?? []).map(mapNoticeRow)
  }, [refreshKeys.notices])
}

export function useLpRequestsMessages() {
  const { refreshKeys } = useLpPortal()
  return useAsyncData(async () => {
    const [requests, messages] = await Promise.all([
      lpPortalApi.getRequests({ pageSize: 50 }),
      lpPortalApi.getMessages({ pageSize: 50 }),
    ])
    return {
      requests: requests.data.items.map(mapServiceRequestRow),
      messages: messages.data.items.map(mapMessageThreadRow),
    }
  }, [refreshKeys.requests, refreshKeys.messages])
}

export function useLpOrganisation() {
  const { refreshKeys } = useLpPortal()
  return useAsyncData(async () => {
    const [org, bankChanges] = await Promise.all([
      lpPortalApi.getOrganisation(),
      lpPortalApi.getBankInstructionChanges(),
    ])
    return { ...org.data, bankChanges: bankChanges.data }
  }, [refreshKeys.organisation])
}

export function useLpSettings() {
  const { refreshKeys } = useLpPortal()
  return useAsyncData(async () => {
    const res = await lpPortalApi.getSettings()
    return res.data
  }, [refreshKeys.settings])
}

export function useLpNotifications(limit = 5) {
  const { refreshKeys } = useLpPortal()
  return useAsyncData(async () => {
    const res = await lpPortalApi.getNotifications(limit)
    return res.data.items
  }, [limit, refreshKeys.notifications])
}
