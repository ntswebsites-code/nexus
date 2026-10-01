"use client"

import * as React from "react"
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Calendar,
  CheckCircle2,
  Coins,
  Download,
  ExternalLink,
  Info,
  Layers,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Wallet,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useLpPortal } from "@/components/lp-portal/lp-portal-context"
import { InfoHint } from "@/components/lp-portal/info-hint"
import { lpPortalApi, type LpRedemptionEstimate, type LpSubscriptionEstimate } from "@/lib/api/lp-portal-api"
import {
  createIdempotencyKey,
  downloadBlob,
  formatDate,
  formatMoney,
  formatMoneyCompact,
  formatUnits,
  parseDecimal,
} from "@/lib/lp-portal/format"
import { useLpDealingOverview } from "@/lib/lp-portal/hooks"
import { getApiErrorCode, getApiErrorMessage, getApiFieldErrors } from "@/lib/lp-portal/use-lp-api"
import { cn } from "@/lib/utils"

type WorkflowHighlight = "subscriptions" | "redemptions" | undefined
type RedemptionMode = "amount" | "units" | "full"
type RequestType = "Subscription" | "Redemption"
type RequestStatus =
  | "Submitted"
  | "Awaiting Funds"
  | "Allocated"
  | "Under Review"
  | "Settled"
  | "Rejected"

function showApiError(err: unknown, fallback = "Request failed") {
  const message = getApiErrorMessage(err, fallback)
  const fieldErrors = getApiFieldErrors(err)
  if (fieldErrors && Object.keys(fieldErrors).length > 0) {
    toast.error(message, {
      description: Object.entries(fieldErrors)
        .map(([field, detail]) => `${field}: ${detail}`)
        .join("\n"),
    })
    return
  }
  toast.error(message)
}

function handleEstimateExpired(err: unknown): boolean {
  const code = getApiErrorCode(err)
  const fieldErrors = getApiFieldErrors(err)
  if (code === "LP_ESTIMATE_EXPIRED" || fieldErrors?.estimateSnapshotId) {
    toast.error(getApiErrorMessage(err, "Your estimate has expired."), {
      description: fieldErrors?.estimateSnapshotId ?? "Please wait for a fresh estimate before submitting.",
    })
    return true
  }
  return false
}

function formatDisplayDate(iso: string) {
  return formatDate(iso, "short")
}

function dealingFrequencyLabel(code: string) {
  if (code === "MONTHLY_LAST_BUSINESS_DAY") return "Monthly on the last business day."
  return code.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toLowerCase())
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] font-medium text-[#475569]">{label}</Label>
      {children}
    </div>
  )
}

function FormRow({
  label,
  children,
  labelClassName,
}: {
  label: string
  children: React.ReactNode
  labelClassName?: string
}) {
  return (
    <div className="grid grid-cols-[minmax(100px,36%)_minmax(0,1fr)] items-center gap-x-3">
      <Label className={cn("text-[12px] font-normal leading-4 text-[#64748b]", labelClassName)}>
        {label}
      </Label>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function KpiCard({
  icon,
  iconBg,
  iconColor,
  label,
  value,
  helper,
}: {
  icon: React.ReactNode
  iconBg: string
  iconColor: string
  label: string
  value: string
  helper: string
}) {
  return (
    <div className="rounded-xl border border-[#e8edf5] bg-white px-3 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-start justify-between gap-2">
        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", iconBg, iconColor)}>
          {icon}
        </span>
        <InfoHint label={label} description={helper} />
      </div>
      <p className="mt-2.5 text-[11px] font-medium leading-4 text-[#64748b]">{label}</p>
      <p className="mt-1 text-[18px] font-bold leading-6 tracking-[-0.03em] tabular-nums text-[#0f172a]">{value}</p>
      <p className="mt-1 text-[11px] leading-4 text-[#94a3b8]">{helper}</p>
    </div>
  )
}

function StatusBadge({ status }: { status: RequestStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold",
        status === "Submitted" && "bg-[#e8f1ff] text-[#2563eb]",
        status === "Awaiting Funds" && "bg-[#fff7ed] text-[#ea580c]",
        status === "Allocated" && "bg-[#e7f8ef] text-[#15803d]",
        status === "Under Review" && "bg-[#f3e8ff] text-[#7c3aed]",
        status === "Settled" && "bg-[#e7f8ef] text-[#15803d]",
        status === "Rejected" && "bg-[#fee2e2] text-[#dc2626]",
      )}
    >
      {status}
    </span>
  )
}

function TypeCell({ type }: { type: RequestType }) {
  const isSub = type === "Subscription"
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#0f172a]">
      <span
        className={cn(
          "flex size-5 items-center justify-center rounded-md",
          isSub ? "bg-[#e8f1ff] text-[#2563eb]" : "bg-[#fce7f3] text-[#db2777]",
        )}
      >
        {isSub ? <ArrowDownToLine className="size-3" /> : <ArrowUpFromLine className="size-3" />}
      </span>
      {type}
    </span>
  )
}

export function LpSubscriptionsRedemptionsScreen({
  highlight,
  initialRequestId,
}: {
  highlight?: WorkflowHighlight
  initialRequestId?: string
}) {
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const { funds, presentationCurrency } = useLpPortal()
  const openEndedFunds = React.useMemo(
    () => funds.filter((f) => f.operatingModel === "OPEN_ENDED"),
    [funds],
  )
  const fundNameById = React.useMemo(
    () => Object.fromEntries(funds.map((f) => [f.id, f.name])),
    [funds],
  )

  const [dealingFundId, setDealingFundId] = React.useState("")
  React.useEffect(() => {
    if (dealingFundId && openEndedFunds.some((f) => f.id === dealingFundId)) return
    if (openEndedFunds[0]) setDealingFundId(openEndedFunds[0].id)
  }, [dealingFundId, openEndedFunds])

  const { data: dealingData, loading: dealingLoading, error: dealingError, reload } =
    useLpDealingOverview(dealingFundId || undefined)

  const overview = dealingData?.overview
  const banks = dealingData?.banks ?? []
  const historyRows = dealingData?.requests ?? []
  const currency = presentationCurrency || "USD"
  const asOfLabel = overview ? formatDisplayDate(overview.asOfDate) : "—"
  const shareClass = overview?.shareClass ?? "Class A"
  const rules = overview?.rules
  const compliance = overview?.compliance
  const navPerUnit = parseDecimal(overview?.navPerUnit)
  const availableUnits = parseDecimal(overview?.availableUnits)
  const availableValue = parseDecimal(overview?.availableToRedeemValue)
  const minBalance = parseDecimal(rules?.minBalanceAmount)
  const minBalanceUnits = parseDecimal(rules?.minBalanceUnits)
  const noticeDays = rules?.noticeDays ?? 0

  const [typeFilter, setTypeFilter] = React.useState("all")
  const [statusFilter, setStatusFilter] = React.useState("all")
  const [subscriptionFiles, setSubscriptionFiles] = React.useState<File[]>([])
  const [submittingSub, setSubmittingSub] = React.useState(false)
  const [submittingRedeem, setSubmittingRedeem] = React.useState(false)
  const [exportingHistory, setExportingHistory] = React.useState(false)
  const [historyDetailOpen, setHistoryDetailOpen] = React.useState(false)
  const [selectedHistoryRow, setSelectedHistoryRow] = React.useState<{
    id: string
    type: RequestType
    fund: string
    shareClass: string
    amount: number
    units: number
    unitsEstimated: boolean
    status: RequestStatus
    submittedOn: string
    expectedSettlement: string
  } | null>(null)

  const [subscription, setSubscription] = React.useState({
    fundId: "",
    shareClass: "Class A",
    amount: "",
    currency: "USD",
    fundingDate: "",
    bankId: "",
  })

  const [redemption, setRedemption] = React.useState({
    mode: "amount" as RedemptionMode,
    value: "",
    earliestDealingDate: "",
    estimatedSettlementDate: "",
  })

  const [subEstimate, setSubEstimate] = React.useState<LpSubscriptionEstimate | null>(null)
  const [subEstimateLoading, setSubEstimateLoading] = React.useState(false)
  const [redeemEstimate, setRedeemEstimate] = React.useState<LpRedemptionEstimate | null>(null)
  const [redeemEstimateLoading, setRedeemEstimateLoading] = React.useState(false)

  React.useEffect(() => {
    if (!overview) return
    setSubscription((prev) => ({
      ...prev,
      fundId: dealingFundId,
      shareClass: overview.shareClass,
      currency: currency,
      fundingDate: prev.fundingDate || rules?.nextEligibleDealingDate || overview.asOfDate,
      bankId: prev.bankId || banks.find((b) => b.isDefault)?.id || banks[0]?.id || "",
    }))
    setRedemption((prev) => ({
      ...prev,
      earliestDealingDate: prev.earliestDealingDate || rules?.nextEligibleDealingDate || overview.asOfDate,
    }))
  }, [overview, dealingFundId, banks, currency, rules])

  const subAmount = Number(subscription.amount) || 0

  React.useEffect(() => {
    if (!dealingFundId || subAmount <= 0) {
      setSubEstimate(null)
      return
    }
    const timer = window.setTimeout(async () => {
      setSubEstimateLoading(true)
      try {
        const res = await lpPortalApi.estimateSubscription({
          fundId: dealingFundId,
          shareClass: subscription.shareClass || shareClass,
          amount: subAmount.toFixed(2),
          currency: subscription.currency,
        })
        setSubEstimate(res.data)
      } catch (err) {
        setSubEstimate(null)
        showApiError(err, "Could not estimate subscription")
      } finally {
        setSubEstimateLoading(false)
      }
    }, 400)
    return () => window.clearTimeout(timer)
  }, [dealingFundId, subAmount, subscription.shareClass, subscription.currency, shareClass])

  const redemptionInput = Number(redemption.value) || 0
  const redeemModeApi =
    redemption.mode === "full" ? "FULL" : redemption.mode === "units" ? "UNITS" : "AMOUNT"

  React.useEffect(() => {
    if (!dealingFundId || !redemption.earliestDealingDate) {
      setRedeemEstimate(null)
      return
    }
    if (redemption.mode !== "full" && redemptionInput <= 0) {
      setRedeemEstimate(null)
      return
    }
    const timer = window.setTimeout(async () => {
      setRedeemEstimateLoading(true)
      try {
        const body = {
          fundId: dealingFundId,
          shareClass,
          mode: redeemModeApi as "AMOUNT" | "UNITS" | "FULL",
          earliestDealingDate: redemption.earliestDealingDate,
          full: redemption.mode === "full",
          ...(redemption.mode === "amount" ? { amount: redemptionInput.toFixed(2) } : {}),
          ...(redemption.mode === "units" ? { units: redemptionInput.toFixed(2) } : {}),
        }
        const res = await lpPortalApi.estimateRedemption(body)
        setRedeemEstimate(res.data)
        setRedemption((prev) => ({
          ...prev,
          estimatedSettlementDate: res.data.estimatedSettlementDate,
          earliestDealingDate: res.data.earliestDealingDate || prev.earliestDealingDate,
        }))
      } catch (err) {
        setRedeemEstimate(null)
        showApiError(err, "Could not estimate redemption")
      } finally {
        setRedeemEstimateLoading(false)
      }
    }, 400)
    return () => window.clearTimeout(timer)
  }, [dealingFundId, shareClass, redemption.mode, redemptionInput, redemption.earliestDealingDate, redeemModeApi])

  const estimatedSubUnits = parseDecimal(subEstimate?.estimatedUnits)
  const mgmtFee = parseDecimal(subEstimate?.managementFee)
  const otherFee = parseDecimal(subEstimate?.otherFees)
  const estimatedTotalInvestment = parseDecimal(subEstimate?.estimatedTotalInvestment)
  const estimatedRedeemUnits = parseDecimal(redeemEstimate?.estimatedUnitsToCancel)
  const estimatedSettlement = parseDecimal(redeemEstimate?.estimatedSettlementAmount)
  const aboveMinBalance = redeemEstimate?.aboveMinBalance ?? true

  const filteredRows = historyRows.filter((row) => {
    const typeOk =
      typeFilter === "all" ||
      (typeFilter === "subscription" && row.type === "Subscription") ||
      (typeFilter === "redemption" && row.type === "Redemption")
    const statusOk = statusFilter === "all" || row.status === statusFilter
    return typeOk && statusOk
  })

  const openHistoryDetail = (row: (typeof historyRows)[number]) => {
    setSelectedHistoryRow(row)
    setHistoryDetailOpen(true)
  }

  React.useEffect(() => {
    if (!initialRequestId || historyRows.length === 0) return
    const row = historyRows.find((item) => item.id === initialRequestId)
    if (row) openHistoryDetail(row)
  }, [initialRequestId, historyRows])

  const onUploadFiles = (files: FileList | null) => {
    if (!files?.length) return
    const next = Array.from(files)
    setSubscriptionFiles((prev) => [...prev, ...next])
    toast.success(`${next.length} file(s) attached.`)
  }

  const reviewSubscription = async (event: React.FormEvent) => {
    event.preventDefault()
    if (subAmount <= 0) {
      toast.error("Enter a subscription amount.")
      return
    }
    if (!subEstimate?.estimateSnapshotId) {
      toast.error("Wait for the allocation estimate before submitting.")
      return
    }
    if (!subscription.bankId) {
      toast.error("Select a source bank account.")
      return
    }
    setSubmittingSub(true)
    try {
      const payload = {
        fundId: dealingFundId,
        shareClass: subscription.shareClass || shareClass,
        amount: subAmount.toFixed(2),
        currency: subscription.currency,
        expectedFundingDate: subscription.fundingDate,
        sourceBankAccountId: subscription.bankId,
        estimateSnapshotId: subEstimate.estimateSnapshotId,
      }
      if (subscriptionFiles.length > 0) {
        const formData = new FormData()
        Object.entries(payload).forEach(([key, value]) => formData.append(key, value))
        subscriptionFiles.forEach((file) => formData.append("files[]", file))
        const res = await lpPortalApi.submitSubscription(formData, createIdempotencyKey())
        toast.success("Subscription submitted.", { description: res.data.id })
      } else {
        const res = await lpPortalApi.submitSubscription(payload, createIdempotencyKey())
        toast.success("Subscription submitted.", { description: res.data.id })
      }
      setSubscriptionFiles([])
      setSubEstimate(null)
      void reload()
    } catch (err) {
      if (handleEstimateExpired(err)) {
        setSubEstimate(null)
      } else {
        showApiError(err, "Subscription submission failed")
      }
    } finally {
      setSubmittingSub(false)
    }
  }

  const reviewRedemption = async (event: React.FormEvent) => {
    event.preventDefault()
    if (redemption.mode !== "full" && redemptionInput <= 0) {
      toast.error("Enter a redemption amount or units.")
      return
    }
    if (!redeemEstimate?.estimateSnapshotId) {
      toast.error("Wait for the redemption estimate before submitting.")
      return
    }
    if (!aboveMinBalance) {
      toast.error("Redemption would breach the minimum balance.")
      return
    }
    setSubmittingRedeem(true)
    try {
      const res = await lpPortalApi.submitRedemption(
        {
          fundId: dealingFundId,
          shareClass,
          mode: redeemModeApi,
          earliestDealingDate: redemption.earliestDealingDate,
          estimateSnapshotId: redeemEstimate.estimateSnapshotId,
          full: redemption.mode === "full",
          ...(redemption.mode === "amount" ? { amount: redemptionInput.toFixed(2) } : {}),
          ...(redemption.mode === "units" ? { units: redemptionInput.toFixed(2) } : {}),
        },
        createIdempotencyKey(),
      )
      toast.success("Redemption submitted.", { description: res.data.id })
      setRedeemEstimate(null)
      void reload()
    } catch (err) {
      if (handleEstimateExpired(err)) {
        setRedeemEstimate(null)
      } else {
        showApiError(err, "Redemption submission failed")
      }
    } finally {
      setSubmittingRedeem(false)
    }
  }

  const exportHistory = async (format: "csv" | "xlsx" = "csv") => {
    setExportingHistory(true)
    try {
      const blob = await lpPortalApi.exportDealingRequests({
        fundId: dealingFundId || undefined,
        type:
          typeFilter === "subscription"
            ? "SUBSCRIPTION"
            : typeFilter === "redemption"
              ? "REDEMPTION"
              : undefined,
        format,
      })
      downloadBlob(blob, `dealing-requests.${format === "xlsx" ? "xlsx" : "csv"}`)
      toast.success("Request history exported.")
    } catch (err) {
      showApiError(err, "Export failed")
    } finally {
      setExportingHistory(false)
    }
  }

  if (dealingError) {
    return (
      <div className="rounded-xl border border-[#fecaca] bg-[#fef2f2] p-6 text-center">
        <p className="text-[14px] font-medium text-[#dc2626]">{dealingError}</p>
        <Button type="button" className="mt-4 rounded-full" onClick={() => void reload()}>
          Retry
        </Button>
      </div>
    )
  }

  if (!openEndedFunds.length && !dealingLoading) {
    return (
      <div className="rounded-xl border border-[#e5e7eb] bg-white p-6 text-center text-[13px] text-[#64748b]">
        No open-ended funds are available for subscriptions and redemptions.
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-8">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight text-[#0f172a]">Subscriptions &amp; Redemptions</h1>
        <p className="mt-1 text-[13px] leading-5 text-[#64748b]">
          Submit new subscription or redemption requests and track their status.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          icon={<Wallet className="size-4" />}
          iconBg="bg-[#e8f1ff]"
          iconColor="text-[#2563eb]"
          label="Account Value"
          value={dealingLoading ? "—" : formatMoneyCompact(overview?.accountValue, currency)}
          helper={`As of ${asOfLabel}`}
        />
        <KpiCard
          icon={<Layers className="size-4" />}
          iconBg="bg-[#e6faf8]"
          iconColor="text-[#0d9488]"
          label="Units Held"
          value={dealingLoading ? "—" : formatUnits(overview?.unitsHeld)}
          helper={`As of ${asOfLabel}`}
        />
        <KpiCard
          icon={<RefreshCw className="size-4" />}
          iconBg="bg-[#f3e8ff]"
          iconColor="text-[#7c3aed]"
          label="NAV per Unit"
          value={dealingLoading ? "—" : formatMoney(overview?.navPerUnit, currency)}
          helper={`As of ${asOfLabel}`}
        />
        <KpiCard
          icon={<Coins className="size-4" />}
          iconBg="bg-[#fff1e8]"
          iconColor="text-[#ea580c]"
          label="Available to Redeem"
          value={dealingLoading ? "—" : formatMoneyCompact(overview?.availableToRedeemValue, currency)}
          helper={dealingLoading ? "—" : `${formatUnits(availableUnits)} Units`}
        />
        <KpiCard
          icon={<ArrowDownToLine className="size-4" />}
          iconBg="bg-[#f3e8ff]"
          iconColor="text-[#9333ea]"
          label="Pending Subscriptions"
          value={dealingLoading ? "—" : formatMoneyCompact(overview?.pendingSubscriptions, currency)}
          helper="Awaiting allocation"
        />
        <KpiCard
          icon={<ArrowUpFromLine className="size-4" />}
          iconBg="bg-[#fee2e2]"
          iconColor="text-[#dc2626]"
          label="Pending Redemptions"
          value={dealingLoading ? "—" : formatMoneyCompact(overview?.pendingRedemptions, currency)}
          helper="In progress"
        />
      </div>

      <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_260px] xl:grid-rows-[auto_auto]">
        <section
          className={cn(
            "@container flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-[#e5e7eb] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)] xl:col-start-1 xl:row-start-1",
            highlight === "subscriptions" && "ring-2 ring-[#93c5fd]",
          )}
        >
          <div className="flex items-center gap-2.5 px-4 pt-4 sm:px-5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#e8f1ff] text-[#2563eb]">
              <ArrowDownToLine className="size-4" strokeWidth={2.25} />
            </span>
            <h2 className="text-[14px] font-semibold leading-5 text-[#0f172a]">New Subscription Request</h2>
          </div>

          <form onSubmit={reviewSubscription} className="flex flex-1 flex-col px-4 pb-4 pt-4 sm:px-5">
            <div className="grid min-w-0 flex-1 grid-cols-1 items-stretch gap-4 @[560px]:grid-cols-[minmax(0,1fr)_minmax(0,42%)]">
              <div className="flex min-w-0 flex-col gap-4">
                <div className="space-y-3.5">
                  <FormRow label="Fund">
                    <Select
                      value={dealingFundId}
                      onValueChange={(fundId) => {
                        setDealingFundId(fundId)
                        setSubscription((v) => ({ ...v, fundId }))
                      }}
                    >
                      <SelectTrigger className="h-9 w-full rounded-lg border-[#d1d5db] bg-white text-[12px] text-[#0f172a] shadow-none">
                        <SelectValue placeholder="Select fund" />
                      </SelectTrigger>
                      <SelectContent>
                        {openEndedFunds.map((fund) => (
                          <SelectItem key={fund.id} value={fund.id}>
                            {fund.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormRow>

                  <FormRow label="Share Class">
                    <Select
                      value={subscription.shareClass}
                      onValueChange={(sc) => setSubscription((v) => ({ ...v, shareClass: sc }))}
                    >
                      <SelectTrigger className="h-9 w-full rounded-lg border-[#d1d5db] bg-white text-[12px] text-[#0f172a] shadow-none">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={shareClass}>{shareClass}</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormRow>

                  <FormRow label="Amount">
                    <div className="flex overflow-hidden rounded-lg border border-[#d1d5db]">
                      <Select
                        value={subscription.currency}
                        onValueChange={(c) => setSubscription((v) => ({ ...v, currency: c }))}
                      >
                        <SelectTrigger className="h-9 w-[70px] shrink-0 rounded-none border-0 border-r border-[#d1d5db] bg-white text-[12px] shadow-none focus:ring-0">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="USD">USD</SelectItem>
                          <SelectItem value="GBP">GBP</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        type="text"
                        inputMode="decimal"
                        value={
                          subscription.amount
                            ? Number(subscription.amount || 0).toLocaleString("en-US", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })
                            : ""
                        }
                        onChange={(e) => {
                          const raw = e.target.value.replace(/,/g, "")
                          if (raw === "" || /^\d*\.?\d*$/.test(raw)) {
                            setSubscription((v) => ({ ...v, amount: raw }))
                          }
                        }}
                        className="h-9 min-w-0 flex-1 rounded-none border-0 text-[12px] tabular-nums text-[#0f172a] shadow-none focus-visible:ring-0"
                      />
                    </div>
                  </FormRow>

                  <FormRow label="Expected Funding Date">
                    <label className="relative flex h-9 w-full cursor-pointer items-center gap-2 rounded-lg border border-[#d1d5db] bg-white px-2.5 text-[12px] text-[#0f172a]">
                      <Calendar className="size-4 shrink-0 text-[#64748b]" strokeWidth={1.75} />
                      <span className="min-w-0 flex-1 truncate">
                        {subscription.fundingDate ? formatDisplayDate(subscription.fundingDate) : "—"}
                      </span>
                      <input
                        type="date"
                        value={subscription.fundingDate}
                        onChange={(e) => setSubscription((v) => ({ ...v, fundingDate: e.target.value }))}
                        className="absolute inset-0 cursor-pointer opacity-0"
                        aria-label="Expected Funding Date"
                      />
                    </label>
                  </FormRow>

                  <FormRow label="Source Bank Account">
                    <Select
                      value={subscription.bankId}
                      onValueChange={(bankId) => setSubscription((v) => ({ ...v, bankId }))}
                    >
                      <SelectTrigger className="h-9 w-full rounded-lg border-[#d1d5db] bg-white text-[12px] text-[#0f172a] shadow-none">
                        <SelectValue placeholder="Select bank account" />
                      </SelectTrigger>
                      <SelectContent>
                        {banks.map((bank) => (
                          <SelectItem key={bank.id} value={bank.id}>
                            {bank.label || `${bank.bankName} ${bank.accountNumberMasked} (${bank.currencyCode})`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormRow>
                </div>

                <div>
                  <p className="mb-2 text-[13px] font-semibold leading-5 text-[#0f172a]">Supporting Documents</p>
                  <div
                    className="rounded-lg border border-dashed border-[#cbd5e1] bg-white px-4 py-5"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault()
                      onUploadFiles(e.dataTransfer.files)
                    }}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept=".pdf,.doc,.docx,.xls,.xlsx"
                      className="hidden"
                      onChange={(e) => {
                        onUploadFiles(e.target.files)
                        e.target.value = ""
                      }}
                    />
                    <div className="flex flex-wrap items-center gap-2.5">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-8 rounded-full border-[#93c5fd] bg-white px-3 text-[12px] font-medium text-[#2563eb] shadow-none hover:bg-[#eff6ff]"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Plus className="size-3.5" strokeWidth={2.25} />
                        Upload Files
                      </Button>
                      <span className="text-[13px] text-[#64748b]">or drag and drop</span>
                    </div>
                    <p className="mt-2 text-[12px] leading-4 text-[#94a3b8]">
                      {subscriptionFiles.length
                        ? `${subscriptionFiles.length} file(s) selected`
                        : `PDF, DOCX, XLSX (Max ${rules?.subscription.maxFileMb ?? 25}MB each)`}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex h-full min-w-0 flex-col gap-3">
                <div className="flex flex-1 flex-col rounded-lg bg-[#f5f8fc] px-5 py-5">
                  <div className="flex items-center gap-1.5">
                    <p className="text-[14px] font-semibold leading-5 text-[#0f172a]">Allocation Estimate</p>
                    <Info className="size-3.5 shrink-0 text-[#94a3b8]" aria-hidden />
                  </div>
                  <p className="mt-0.5 text-[12px] leading-4 text-[#64748b]">
                    {subEstimateLoading ? "Calculating…" : "Based on current NAV"}
                  </p>

                  <div className="mt-5 flex flex-1 flex-col">
                    <div className="space-y-3">
                      <div className="flex items-baseline justify-between gap-3 text-[13px]">
                        <span className="text-[#64748b]">Estimated NAV per Unit</span>
                        <span className="shrink-0 font-semibold tabular-nums text-[#0f172a]">
                          {formatMoney(subEstimate?.navPerUnit ?? navPerUnit, currency)}
                        </span>
                      </div>
                      <div className="flex items-baseline justify-between gap-3 text-[13px]">
                        <span className="text-[#64748b]">Estimated Units</span>
                        <span className="shrink-0 font-bold tabular-nums text-[#0f172a]">
                          {subAmount > 0 ? formatUnits(estimatedSubUnits) : "—"}
                        </span>
                      </div>
                    </div>

                    <div className="mt-4">
                      <p className="mb-2.5 text-[13px] font-semibold text-[#0f172a]">Estimated Fees</p>
                      <div className="space-y-2.5">
                        <div className="flex items-baseline justify-between gap-3 text-[13px]">
                          <span className="text-[#64748b]">Management Fee (Est.)</span>
                          <span className="shrink-0 font-semibold tabular-nums text-[#0f172a]">
                            {formatMoney(mgmtFee, currency)}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between gap-3 text-[13px]">
                          <span className="text-[#64748b]">Other Fees (Est.)</span>
                          <span className="shrink-0 font-semibold tabular-nums text-[#0f172a]">
                            {formatMoney(otherFee, currency)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-auto border-t border-[#e2e8f0] pt-4">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-[13px] font-semibold text-[#0f172a]">Estimated Total Investment</span>
                        <span className="shrink-0 text-[15px] font-bold tabular-nums text-[#0f172a]">
                          {formatMoney(estimatedTotalInvestment, currency)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 gap-2 rounded-lg border border-[#bfdbfe] bg-[#ebf1ff] px-3.5 py-3 text-[12px] leading-[18px] text-[#2563eb]">
                  <Info className="mt-0.5 size-3.5 shrink-0" strokeWidth={2} />
                  <span>
                    {subEstimate?.disclaimer ??
                      "Final allocation will be based on the NAV on the applicable dealing date and may differ."}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-auto flex justify-end pt-4">
              <Button
                type="submit"
                disabled={submittingSub || subEstimateLoading || !subEstimate}
                className="h-10 shrink-0 rounded-full bg-[#2563eb] px-5 text-[13px] font-semibold text-white shadow-none hover:bg-[#1d4ed8]"
              >
                {submittingSub ? "Submitting…" : "Review Subscription Request"}
              </Button>
            </div>
          </form>
        </section>

        <section
          className={cn(
            "@container flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-[#e5e7eb] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)] xl:col-start-2 xl:row-start-1",
            highlight === "redemptions" && "ring-2 ring-[#fca5a5]",
          )}
        >
          <div className="flex items-center gap-2.5 px-6 pb-0 pt-5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#ffe4e6] text-[#f43f5e]">
              <RefreshCw className="size-4" strokeWidth={2.25} />
            </span>
            <h2 className="text-[15px] font-semibold leading-5 tracking-[-0.01em] text-[#0f172a]">
              New Redemption Request
            </h2>
          </div>

          <form onSubmit={reviewRedemption} className="flex min-h-0 flex-1 flex-col px-6 pb-5 pt-5">
            <div className="flex flex-1 flex-col gap-5">
              <div>
                <div className="mb-2.5 flex items-center gap-1.5">
                  <Label className="text-[13px] font-medium leading-5 text-[#0f172a]">Redemption Type</Label>
                  <Info className="size-3.5 text-[#94a3b8]" aria-hidden />
                </div>
                <div className="grid grid-cols-3 gap-2.5">
                  {(
                    [
                      { id: "amount", label: "Amount" },
                      { id: "units", label: "Units" },
                      { id: "full", label: "Full Redemption" },
                    ] as const
                  ).map((option) => {
                    const selected = redemption.mode === option.id
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => {
                          if (option.id === "full") {
                            setRedemption((v) => ({
                              ...v,
                              mode: "full",
                              value: String(availableValue),
                            }))
                          } else {
                            setRedemption((v) => ({ ...v, mode: option.id, value: "" }))
                          }
                        }}
                        className={cn(
                          "flex h-11 items-center justify-center gap-2 rounded-lg border bg-white px-2 text-[13px] font-medium",
                          selected ? "border-[#2563eb] text-[#0f172a]" : "border-[#e5e7eb] text-[#0f172a]",
                        )}
                      >
                        <span
                          className={cn(
                            "flex size-4 shrink-0 items-center justify-center rounded-full border-[1.5px]",
                            selected ? "border-[#2563eb]" : "border-[#cbd5e1]",
                          )}
                        >
                          {selected && <span className="size-2 rounded-full bg-[#2563eb]" />}
                        </span>
                        <span className="leading-none">{option.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {redemption.mode !== "full" && (
                <FormRow
                  label={redemption.mode === "units" ? "Requested Units" : "Requested Amount"}
                  labelClassName="font-medium text-[#0f172a]"
                >
                  <div className="flex gap-2">
                    {redemption.mode === "amount" && (
                      <Select value={currency} onValueChange={() => undefined}>
                        <SelectTrigger className="h-9 w-[78px] shrink-0 rounded-lg border-[#d1d5db] bg-white text-[13px] text-[#0f172a] shadow-none">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={currency}>{currency}</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                    <Input
                      type="text"
                      inputMode="decimal"
                      value={
                        redemption.mode === "amount" && redemption.value
                          ? Number(redemption.value || 0).toLocaleString("en-US", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })
                          : redemption.value
                      }
                      onChange={(e) => {
                        const raw = e.target.value.replace(/,/g, "")
                        if (raw === "" || /^\d*\.?\d*$/.test(raw)) {
                          setRedemption((v) => ({ ...v, value: raw }))
                        }
                      }}
                      className="h-9 flex-1 rounded-lg border-[#d1d5db] text-right text-[13px] tabular-nums text-[#0f172a] shadow-none"
                    />
                  </div>
                </FormRow>
              )}

              <div className="space-y-2.5 border-b border-[#e5e7eb] pb-5">
                <div className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="text-[#64748b]">Estimated Units to be Cancelled</span>
                  <span className="font-bold tabular-nums text-[#0f172a]">
                    {redeemEstimateLoading ? "…" : formatUnits(estimatedRedeemUnits)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="text-[#64748b]">Estimated Settlement Amount</span>
                  <span className="font-bold tabular-nums text-[#0f172a]">
                    {redeemEstimateLoading ? "…" : formatMoney(estimatedSettlement, currency)}
                  </span>
                </div>
              </div>

              <div className="space-y-3.5">
                <div className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="font-semibold text-[#0f172a]">Notice Period</span>
                  <span className="font-semibold text-[#0f172a]">{noticeDays} Calendar Days</span>
                </div>

                <FormRow label="Earliest Dealing Date" labelClassName="text-[#64748b]">
                  <label className="relative flex h-9 w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-[#d1d5db] bg-white px-3 text-[13px] text-[#0f172a]">
                    <span className="truncate">
                      {redemption.earliestDealingDate
                        ? formatDisplayDate(redemption.earliestDealingDate)
                        : "—"}
                    </span>
                    <Calendar className="size-4 shrink-0 text-[#64748b]" strokeWidth={1.75} />
                    <input
                      type="date"
                      value={redemption.earliestDealingDate}
                      onChange={(e) => setRedemption((v) => ({ ...v, earliestDealingDate: e.target.value }))}
                      className="absolute inset-0 cursor-pointer opacity-0"
                      aria-label="Earliest Dealing Date"
                    />
                  </label>
                </FormRow>

                <FormRow label="Estimated Settlement Date" labelClassName="text-[#64748b]">
                  <div className="flex h-9 items-center rounded-lg border border-[#d1d5db] bg-[#f9fafb] px-3 text-[13px] text-[#0f172a]">
                    {redeemEstimate?.estimatedSettlementDate
                      ? formatDisplayDate(redeemEstimate.estimatedSettlementDate)
                      : redemption.estimatedSettlementDate
                        ? formatDisplayDate(redemption.estimatedSettlementDate)
                        : "—"}
                  </div>
                </FormRow>
              </div>

              <div className="flex gap-2.5 rounded-lg border border-[#fde68a] bg-[#fffbeb] px-3.5 py-3 text-[12px] leading-[18px] text-[#78716c]">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[#f59e0b]" strokeWidth={2} />
                <span>
                  {redeemEstimate?.disclaimer ??
                    "Estimates are subject to change based on the final NAV on the dealing date. Actual settlement may vary."}
                </span>
              </div>
            </div>

            <div className="mt-auto flex justify-end pt-5">
              <Button
                type="submit"
                disabled={submittingRedeem || redeemEstimateLoading || !redeemEstimate}
                className="h-10 w-full shrink-0 rounded-full bg-[#ef4444] text-[13px] font-semibold text-white shadow-none hover:bg-[#dc2626] sm:w-auto sm:min-w-[260px] sm:px-6"
              >
                {submittingRedeem ? "Submitting…" : "Review Redemption Request"}
              </Button>
            </div>
          </form>
        </section>

        <section className="overflow-hidden rounded-lg border border-[#e5e7eb] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)] xl:col-start-3 xl:row-span-2 xl:row-start-1 xl:self-start">
          <div className="border-b border-[#f3f4f6] px-5 py-4">
            <h2 className="text-[15px] font-semibold leading-5 text-[#0f172a]">Validation Rules</h2>
          </div>

          <div className="border-b border-[#f3f4f6] px-5 py-4">
            <div className="flex items-center gap-1.5">
              <p className="text-[13px] font-semibold text-[#0f172a]">Minimum Balance</p>
              <Info className="size-3.5 text-[#94a3b8]" aria-hidden />
            </div>
            <p className="mt-1.5 text-[12px] leading-[18px] text-[#64748b]">
              Minimum account balance after redemption must be at least {formatMoney(minBalance, currency, false)} or{" "}
              {formatUnits(minBalanceUnits, 0)} units.
            </p>
            <div
              className={cn(
                "mt-2.5 flex items-center gap-1.5 text-[12px]",
                aboveMinBalance ? "text-[#0f172a]" : "text-[#dc2626]",
              )}
            >
              <span
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded-full",
                  aboveMinBalance ? "bg-[#10b981]" : "bg-[#ef4444]",
                )}
              >
                <CheckCircle2 className="size-2.5 text-white" strokeWidth={3} />
              </span>
              <span>
                {aboveMinBalance
                  ? "You will remain above the minimum balance."
                  : "This request would breach the minimum balance."}
              </span>
            </div>
          </div>

          <div className="border-b border-[#f3f4f6] px-5 py-4">
            <div className="flex items-center gap-1.5">
              <p className="text-[13px] font-semibold text-[#0f172a]">Notice Period</p>
              <Info className="size-3.5 text-[#94a3b8]" aria-hidden />
            </div>
            <p className="mt-1.5 text-[12px] leading-[18px] text-[#64748b]">
              Redemptions require {noticeDays} calendar days&apos; notice.
            </p>
            <div className="mt-3">
              <p className="text-[11px] font-medium text-[#64748b]">Next eligible dealing date</p>
              <p className="mt-0.5 text-[13px] font-semibold text-[#0f172a]">
                {rules?.nextEligibleDealingDate ? formatDisplayDate(rules.nextEligibleDealingDate) : "—"}
              </p>
            </div>
          </div>

          <div className="border-b border-[#f3f4f6] px-5 py-4">
            <div className="flex items-center gap-1.5">
              <p className="text-[13px] font-semibold text-[#0f172a]">Dealing Frequency</p>
              <Info className="size-3.5 text-[#94a3b8]" aria-hidden />
            </div>
            <p className="mt-1.5 text-[12px] leading-[18px] text-[#64748b]">
              {rules?.dealingFrequency ? dealingFrequencyLabel(rules.dealingFrequency) : "—"}
            </p>
            <div className="mt-3">
              <p className="text-[11px] font-medium text-[#64748b]">Next eligible date</p>
              <p className="mt-0.5 text-[13px] font-semibold text-[#0f172a]">
                {rules?.nextEligibleDealingDate ? formatDisplayDate(rules.nextEligibleDealingDate) : "—"}
              </p>
            </div>
          </div>

          <div className="px-5 py-4">
            <div className="flex items-center gap-1.5">
              <p className="text-[13px] font-semibold text-[#0f172a]">Compliance Checks</p>
              <Info className="size-3.5 text-[#94a3b8]" aria-hidden />
            </div>
            <ul className="mt-3 space-y-2.5">
              {[
                {
                  ok: compliance?.accreditedInvestor ?? false,
                  label: "Accredited Investor Verified",
                },
                {
                  ok: (compliance?.kycStatus ?? "").toUpperCase() === "APPROVED",
                  label: `KYC Status: ${compliance?.kycStatus ?? "Unknown"}`,
                },
                {
                  ok: compliance?.noUnsettledCapitalCalls ?? true,
                  label: "No Unsettled Capital Calls",
                },
                {
                  ok: compliance?.noLegalHolds ?? false,
                  label: "No Legal Holds",
                },
              ].map((item) => (
                <li key={item.label} className="flex items-center gap-2 text-[12px] text-[#475569]">
                  <CheckCircle2
                    className={cn("size-4 shrink-0", item.ok ? "text-[#10b981]" : "text-[#ef4444]")}
                    strokeWidth={2}
                  />
                  <span>{item.label}</span>
                </li>
              ))}
              {(compliance?.blockers ?? []).map((blocker) => (
                <li key={blocker} className="flex items-center gap-2 text-[12px] text-[#dc2626]">
                  <AlertTriangle className="size-4 shrink-0" />
                  <span>{blocker}</span>
                </li>
              ))}
            </ul>

            {compliance?.termsUrl ? (
              <Button
                type="button"
                variant="outline"
                className="mt-5 h-10 w-full rounded-full border-[#bfdbfe] bg-white text-[13px] font-semibold text-[#2563eb] shadow-none hover:bg-[#eff6ff]"
                onClick={() => window.open(compliance.termsUrl!, "_blank", "noopener,noreferrer")}
              >
                View Full Terms
                <ExternalLink className="size-3.5" />
              </Button>
            ) : null}
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-[#e8edf5] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] xl:col-span-2 xl:col-start-1 xl:row-start-2">
          <div className="flex flex-col gap-3 border-b border-[#eef2f7] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-1.5">
              <h2 className="text-[14px] font-semibold text-[#0f172a]">Subscriptions &amp; Redemptions History</h2>
              <InfoHint
                label="Subscriptions & Redemptions History"
                description="Investor-scoped subscription and redemption requests for open-ended funds."
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={exportingHistory}
                className="h-8 rounded-full border-[#e2e8f0] bg-white px-3 text-[11px] font-medium text-[#2563eb] shadow-none"
                onClick={() => void exportHistory("csv")}
              >
                <Download className="size-3.5" />
                Export
              </Button>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="h-8 w-[130px] rounded-full border-[#e2e8f0] bg-white text-[11px] shadow-none">
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="subscription">Subscriptions</SelectItem>
                  <SelectItem value="redemption">Redemptions</SelectItem>
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-8 w-[140px] rounded-full border-[#e2e8f0] bg-white text-[11px] shadow-none">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {(
                    [
                      "Submitted",
                      "Awaiting Funds",
                      "Allocated",
                      "Under Review",
                      "Settled",
                      "Rejected",
                    ] as RequestStatus[]
                  ).map((status) => (
                    <SelectItem key={status} value={status}>
                      {status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="w-full overflow-auto">
            <table className="w-full min-w-[960px] border-collapse text-left">
              <thead>
                <tr className="border-b border-[#e8edf5] bg-[#f8fafc]">
                  {[
                    "ID",
                    "Type",
                    "Fund",
                    "Share Class",
                    "Amount / Units",
                    "Status",
                    "Submitted On",
                    "Expected Settlement",
                    "Actions",
                  ].map((header) => (
                    <th
                      key={header}
                      className="h-9 whitespace-nowrap px-3 text-[10px] font-semibold uppercase tracking-wide text-[#64748b]"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dealingLoading ? (
                  <tr>
                    <td colSpan={9} className="h-24 text-center text-[12px] text-[#64748b]">
                      Loading request history…
                    </td>
                  </tr>
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="h-24 text-center text-[12px] text-[#64748b]">
                      No requests match the current filters.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => (
                    <tr key={row.id} className="border-b border-[#f1f5f9] last:border-0 hover:bg-[#f8fafc]/80">
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <button
                          type="button"
                          className="text-[12px] font-semibold text-[#2563eb] hover:underline"
                          onClick={() => openHistoryDetail(row)}
                        >
                          {row.id}
                        </button>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <TypeCell type={row.type} />
                      </td>
                      <td className="max-w-[200px] truncate px-3 py-2.5 text-[12px] text-[#334155]">
                        {fundNameById[row.fund] ?? row.fund}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-[12px] text-[#334155]">
                        {row.shareClass || shareClass}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-[12px]">
                        <div className="font-medium tabular-nums text-[#0f172a]">
                          {formatMoney(row.amount, currency)}
                        </div>
                        <div className="text-[10px] text-[#94a3b8]">
                          {formatUnits(row.units)} Units{row.unitsEstimated ? " (Est.)" : ""}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <StatusBadge status={row.status} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-[12px] text-[#475569]">{row.submittedOn}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-[12px] text-[#475569]">
                        {row.expectedSettlement ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-8 rounded-full text-[#64748b]"
                              aria-label={`Actions for ${row.id}`}
                            >
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem onClick={() => openHistoryDetail(row)}>
                              View details
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <Dialog open={historyDetailOpen} onOpenChange={setHistoryDetailOpen}>
        <DialogContent className="max-w-md rounded-xl">
          <DialogHeader>
            <DialogTitle>{selectedHistoryRow?.type ?? "Request"} details</DialogTitle>
            <DialogDescription>{selectedHistoryRow?.id}</DialogDescription>
          </DialogHeader>
          {selectedHistoryRow ? (
            <dl className="space-y-2.5 text-[12px]">
              {[
                ["Fund", fundNameById[selectedHistoryRow.fund] ?? selectedHistoryRow.fund],
                ["Share class", selectedHistoryRow.shareClass || shareClass],
                ["Amount", formatMoney(selectedHistoryRow.amount, currency)],
                [
                  "Units",
                  `${formatUnits(selectedHistoryRow.units)}${selectedHistoryRow.unitsEstimated ? " (Est.)" : ""}`,
                ],
                ["Status", selectedHistoryRow.status],
                ["Submitted", selectedHistoryRow.submittedOn],
                ["Expected settlement", selectedHistoryRow.expectedSettlement ?? "—"],
              ].map(([label, value]) => (
                <div key={label} className="grid grid-cols-[130px_1fr] gap-2">
                  <dt className="text-[#9ca3af]">{label}</dt>
                  <dd className="font-medium text-[#111827]">{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
