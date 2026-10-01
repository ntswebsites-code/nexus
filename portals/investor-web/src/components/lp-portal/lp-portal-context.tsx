"use client"

import * as React from "react"
import { lpPortalApi, type LpNotificationItem, type LpSession } from "@/lib/api/lp-portal-api"
import { mapSessionFund } from "@/lib/lp-portal/mappers"
import {
  joinLpPortalOrg,
  subscribeLpRealtime,
} from "@/lib/lp-portal/realtime"
import type { FundOperatingModel, LpFund, LpPortalClient, LpPortalUnreadCounts, LpRole, ValuationStatus } from "@/lib/lp-portal/types"

export type LpFundContextId = "all" | string

export type LpRefreshScope =
  | "dashboard"
  | "capital"
  | "performance"
  | "dealing"
  | "activity"
  | "documents"
  | "notices"
  | "requests"
  | "messages"
  | "organisation"
  | "settings"
  | "notifications"

interface LpPortalContextValue {
  session: LpSession | null
  sessionLoading: boolean
  sessionError: string | null
  client: LpPortalClient | null
  lpRole: LpRole | null
  funds: LpFund[]
  selectedFundId: LpFundContextId
  selectedFund: LpFund | null
  operatingModel: FundOperatingModel | "MIXED"
  asOfDate: string
  valuationStatus: ValuationStatus
  presentationCurrency: string
  unreadCounts: LpPortalUnreadCounts
  notifications: LpNotificationItem[]
  notificationsLoading: boolean
  refreshKeys: Partial<Record<LpRefreshScope, number>>
  setSelectedFundId: (fundId: LpFundContextId) => void
  setAsOfDate: (date: string) => void
  refreshSession: () => Promise<void>
  refreshNotifications: () => Promise<void>
  bumpRefresh: (scope: LpRefreshScope | LpRefreshScope[]) => void
}

const LpPortalContext = React.createContext<LpPortalContextValue | null>(null)

export function LpPortalProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = React.useState<LpSession | null>(null)
  const [sessionLoading, setSessionLoading] = React.useState(true)
  const [sessionError, setSessionError] = React.useState<string | null>(null)
  const [selectedFundId, setSelectedFundId] = React.useState<LpFundContextId>("all")
  const [asOfDate, setAsOfDate] = React.useState("")
  const [notifications, setNotifications] = React.useState<LpNotificationItem[]>([])
  const [notificationsLoading, setNotificationsLoading] = React.useState(false)
  const [refreshKeys, setRefreshKeys] = React.useState<Partial<Record<LpRefreshScope, number>>>({})

  const funds = React.useMemo(() => (session?.funds ?? []).map(mapSessionFund), [session])

  const selectedFund = React.useMemo(
    () => funds.find((fund) => fund.id === selectedFundId) ?? null,
    [funds, selectedFundId],
  )

  const bumpRefresh = React.useCallback((scope: LpRefreshScope | LpRefreshScope[]) => {
    const scopes = Array.isArray(scope) ? scope : [scope]
    setRefreshKeys((prev) => {
      const next = { ...prev }
      for (const key of scopes) next[key] = (next[key] ?? 0) + 1
      return next
    })
  }, [])

  const refreshSession = React.useCallback(async () => {
    setSessionLoading(true)
    setSessionError(null)
    try {
      const response = await lpPortalApi.getSession()
      setSession(response.data)
      setAsOfDate((prev) => prev || response.data.defaultAsOfDate)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to load portal session"
      setSessionError(message)
      setSession(null)
    } finally {
      setSessionLoading(false)
    }
  }, [])

  const refreshNotifications = React.useCallback(async () => {
    setNotificationsLoading(true)
    try {
      const response = await lpPortalApi.getNotifications(5)
      setNotifications(response.data.items)
    } catch {
      setNotifications([])
    } finally {
      setNotificationsLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void refreshSession()
  }, [refreshSession])

  React.useEffect(() => {
    if (!session) return
    void refreshNotifications()
  }, [session, refreshNotifications])

  React.useEffect(() => {
    if (selectedFund) {
      setAsOfDate(selectedFund.asOfDate)
      return
    }
    if (session?.defaultAsOfDate) {
      setAsOfDate(session.defaultAsOfDate)
    }
  }, [selectedFund, session?.defaultAsOfDate])

  React.useEffect(() => {
    if (!session) return

    joinLpPortalOrg()

    const unsubs = [
      subscribeLpRealtime("lp_notification", () => {
        void refreshNotifications()
        void refreshSession()
      }),
      subscribeLpRealtime("lp_notice_updated", () => {
        bumpRefresh(["notices", "notifications", "dashboard"])
        void refreshNotifications()
      }),
      subscribeLpRealtime("lp_request_created", () => {
        bumpRefresh(["requests", "notifications"])
        void refreshNotifications()
      }),
      subscribeLpRealtime("lp_request_updated", () => bumpRefresh("requests")),
      subscribeLpRealtime("lp_request_message", () => bumpRefresh(["requests", "messages"])),
      subscribeLpRealtime("lp_thread_message", () => bumpRefresh(["messages", "notifications"])),
      subscribeLpRealtime("lp_thread_read", () => bumpRefresh("messages")),
      subscribeLpRealtime("lp_thread_updated", () => bumpRefresh("messages")),
    ]

    return () => {
      for (const unsub of unsubs) unsub()
    }
  }, [session, bumpRefresh, refreshNotifications, refreshSession])

  const operatingModel = React.useMemo((): FundOperatingModel | "MIXED" => {
    if (selectedFund) return selectedFund.operatingModel
    const models = new Set(funds.map((f) => f.operatingModel))
    if (models.size <= 1) return funds[0]?.operatingModel ?? "MIXED"
    return "MIXED"
  }, [funds, selectedFund])

  const value = React.useMemo<LpPortalContextValue>(
    () => ({
      session,
      sessionLoading,
      sessionError,
      client: session?.client ?? null,
      lpRole: session?.lpRole ?? null,
      funds,
      selectedFundId,
      selectedFund,
      operatingModel,
      asOfDate,
      valuationStatus: (selectedFund?.valuationStatus ??
        session?.defaultValuationStatus ??
        "FINAL") as ValuationStatus,
      presentationCurrency: session?.presentationCurrency ?? "USD",
      // The API returns these as STRINGS ("0"/"1"). Every consumer treats them as numbers —
      // the topbar sums them for the bell badge — so "1" + "0" + "1" concatenated to "101",
      // which then compared greater than 9 and rendered a "9+" badge for an investor whose real
      // total was 2. Coerced once here so every consumer of the context gets numbers.
      unreadCounts: {
        requests: Number(session?.unreadCounts?.requests ?? 0) || 0,
        messages: Number(session?.unreadCounts?.messages ?? 0) || 0,
        notices: Number(session?.unreadCounts?.notices ?? 0) || 0,
        notifications: Number(session?.unreadCounts?.notifications ?? 0) || 0,
      },
      notifications,
      notificationsLoading,
      refreshKeys,
      setSelectedFundId,
      setAsOfDate,
      refreshSession,
      refreshNotifications,
      bumpRefresh,
    }),
    [
      asOfDate,
      bumpRefresh,
      funds,
      notifications,
      notificationsLoading,
      operatingModel,
      refreshKeys,
      refreshNotifications,
      refreshSession,
      selectedFund,
      selectedFundId,
      session,
      sessionError,
      sessionLoading,
    ],
  )

  return <LpPortalContext.Provider value={value}>{children}</LpPortalContext.Provider>
}

export function useLpPortal() {
  const context = React.useContext(LpPortalContext)
  if (!context) {
    throw new Error("useLpPortal must be used within LpPortalProvider")
  }
  return context
}

export function useLpFundScope() {
  const { selectedFundId, asOfDate, presentationCurrency } = useLpPortal()
  return {
    fundId: selectedFundId === "all" ? undefined : selectedFundId,
    asOfDate,
    presentationCurrency,
  }
}
