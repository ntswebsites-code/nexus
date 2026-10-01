"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  CalendarDays,
  Check,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Copy,
  Download,
  Eye,
  FilePenLine,
  FileText,
  Info,
  MoreHorizontal,
  Sparkles,
  X,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useLpFundScope, useLpPortal } from "@/components/lp-portal/lp-portal-context"
import { lpPortalApi } from "@/lib/api/lp-portal-api"
import { createIdempotencyKey, downloadBlob, formatMoneyCompact, parseDecimal } from "@/lib/lp-portal/format"
import { resolveDocumentHref } from "@/lib/lp-portal/navigation"
import { useLpCapitalCallDetail, useLpCapitalCalls, useLpDistributions } from "@/lib/lp-portal/hooks"
import { cn } from "@/lib/utils"

type CallStatus = "Issued" | "Paid" | "Overdue"
type DistType = "Return of Capital" | "Income"
type ActivityTab = "calls" | "distributions"

interface CapitalCallRow {
  id: string
  callNo: number
  fund: string
  issueDate: string
  dueDate: string
  amount: number
  paid: number
  outstanding: number
  status: CallStatus
  dueSoon?: boolean
  daysUntilDue?: number
  acknowledgedAt?: string | null
}

interface DistributionRow {
  id: string
  ref: string
  fund: string
  type: DistType
  gross: number
  adjustments: number
  netPaid: number
  paymentDate: string
  documentId?: string | null
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value)
}

function StatusBadge({ status }: { status: CallStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold",
        status === "Issued" && "bg-[#e8f1ff] text-[#2563eb]",
        status === "Paid" && "bg-[#e7f8ef] text-[#15803d]",
        status === "Overdue" && "bg-[#fee2e2] text-[#dc2626]",
      )}
    >
      {status}
    </span>
  )
}

function RadioMarker({ selected }: { selected: boolean }) {
  return (
    <span
      className={cn(
        "mx-auto flex size-[15px] items-center justify-center rounded-full border-[1.5px]",
        selected ? "border-[#2563eb] bg-[#2563eb]" : "border-[#cbd5e1] bg-white",
      )}
    >
      {selected && <span className="size-[5px] rounded-full bg-white" />}
    </span>
  )
}

function PdfIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-5 shrink-0", className)} aria-hidden>
      <path
        fill="#e11d48"
        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"
      />
      <path fill="#fda4af" d="M14 2v6h6" />
      <text
        x="12"
        y="17"
        textAnchor="middle"
        fill="white"
        fontSize="6"
        fontWeight="700"
        fontFamily="system-ui, sans-serif"
      >
        PDF
      </text>
    </svg>
  )
}

function KpiCard({
  icon,
  iconBg,
  iconColor,
  label,
  value,
  footer,
  footerExtra,
  onFooterClick,
}: {
  icon: React.ReactNode
  iconBg: string
  iconColor: string
  label: string
  value: string
  footer: string
  footerExtra?: React.ReactNode
  onFooterClick?: () => void
}) {
  return (
    <div className="rounded-xl border border-[#e8edf5] bg-white px-3 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-start gap-2.5">
        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", iconBg, iconColor)}>
          {icon}
        </span>
        <div className="min-w-0 pt-0.5">
          <p className="text-[11px] font-medium leading-4 text-[#475569]">{label}</p>
          <p className="mt-1 text-[20px] font-bold leading-6 tracking-[-0.03em] text-[#0f172a]">{value}</p>
          <button
            type="button"
            className="mt-1.5 text-[11px] font-medium leading-4 text-[#2563eb] hover:underline"
            onClick={onFooterClick}
          >
            {footer}
            {footerExtra}
          </button>
        </div>
      </div>
    </div>
  )
}

function DetailRow({
  label,
  value,
  valueClassName,
}: {
  label: string
  value: React.ReactNode
  valueClassName?: string
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 text-[12px]">
      <span className="text-[#64748b]">{label}</span>
      <span className={cn("text-right font-medium tabular-nums text-[#0f172a]", valueClassName)}>{value}</span>
    </div>
  )
}

function OutlineAction({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled}
      onClick={onClick}
      className="h-8 gap-1.5 rounded-full border-[#93c5fd] bg-white px-3 text-[11px] font-semibold text-[#2563eb] shadow-none hover:bg-[#eff6ff] hover:text-[#1d4ed8] disabled:opacity-45"
    >
      {children}
    </Button>
  )
}

function PrimaryAction({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <Button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="h-8 gap-1.5 rounded-full bg-[#2563eb] px-3.5 text-[11px] font-semibold text-white shadow-sm hover:bg-[#1d4ed8] disabled:opacity-45"
    >
      {children}
    </Button>
  )
}

export function LpCapitalActivityScreen({
  initialTab = "calls",
  initialCallId,
}: {
  initialTab?: ActivityTab
  initialCallId?: string
}) {
  const router = useRouter()
  const { asOfDate, lpRole } = useLpPortal()
  const { fundId } = useLpFundScope()
  const { data: callsData, loading: callsLoading, error: callsError, reload: reloadCalls } = useLpCapitalCalls()
  const { data: distributionsData, loading: distributionsLoading, error: distributionsError, reload: reloadDistributions } = useLpDistributions()
  const [activeTab, setActiveTab] = React.useState<ActivityTab>(initialTab)
  const [selectedCallId, setSelectedCallId] = React.useState<string | null>(null)
  const { data: callDetailData, reload: reloadCallDetail } = useLpCapitalCallDetail(selectedCallId)
  const [acknowledged, setAcknowledged] = React.useState<Record<string, boolean>>({})
  const [copied, setCopied] = React.useState(false)
  const [showAllCalls, setShowAllCalls] = React.useState(false)
  const [showAllDistributions, setShowAllDistributions] = React.useState(false)
  const [wiringDialogOpen, setWiringDialogOpen] = React.useState(false)
  const [actionLoading, setActionLoading] = React.useState<string | null>(null)
  const paymentInputRef = React.useRef<HTMLInputElement>(null)
  const canWrite = lpRole !== "VIEWER"

  React.useEffect(() => {
    setActiveTab(initialTab)
  }, [initialTab])

  const calls = callsData?.calls ?? []
  const distributions = distributionsData?.items ?? []
  const summary = callsData?.summary

  React.useEffect(() => {
    if (initialCallId) {
      setSelectedCallId(initialCallId)
      setActiveTab("calls")
    }
  }, [initialCallId])

  React.useEffect(() => {
    if (!initialCallId && !selectedCallId && calls.length > 0) {
      setSelectedCallId(calls[0].id)
    }
  }, [calls, selectedCallId, initialCallId])

  const selectedCall = calls.find((call) => call.id === selectedCallId) ?? null
  const callDetail = callDetailData?.detail ?? null
  const callDocuments = callDetailData?.documents ?? []
  const isAcknowledged = selectedCall
    ? Boolean(acknowledged[selectedCall.id] || selectedCall.acknowledgedAt || callDetail?.acknowledgedAt)
    : false
  const showDetailPanel = activeTab === "calls" && Boolean(selectedCall)

  const visibleCalls = showAllCalls ? calls : calls.slice(0, 8)
  const visibleDistributions =
    activeTab === "distributions" || showAllDistributions ? distributions : distributions.slice(0, 3)

  const wiringReference = callDetail?.wiring.reference ?? ""

  const paidCallCount = summary?.paidCallCount ?? 0
  const dueSoonCount = summary?.dueSoonCount ?? 0
  const dueSoonAmount = parseDecimal(summary?.dueSoonAmount)
  const totalDistributions = parseDecimal(summary?.totalDistributions)
  const upcomingDistributionNotices = summary?.upcomingDistributionNotices

  const loading = callsLoading || distributionsLoading
  const error = callsError ?? distributionsError

  const acknowledgeCall = async (callId: string) => {
    if (!canWrite) return
    setActionLoading(`ack-${callId}`)
    try {
      await lpPortalApi.acknowledgeCapitalCall(callId, createIdempotencyKey())
      setAcknowledged((current) => ({ ...current, [callId]: true }))
      toast.success("Capital call acknowledged")
      void reloadCalls()
      void reloadCallDetail()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to acknowledge capital call")
    } finally {
      setActionLoading(null)
    }
  }

  const copyReference = async () => {
    if (!wiringReference) return
    try {
      await navigator.clipboard.writeText(wiringReference)
      setCopied(true)
      toast.success("Wiring reference copied")
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      toast.error("Unable to copy reference")
    }
  }

  const downloadNotice = async (call: CapitalCallRow) => {
    setActionLoading(`notice-${call.id}`)
    try {
      const blob = await lpPortalApi.downloadCapitalCallNotice(call.id)
      downloadBlob(blob, `Call-Notice-No-${call.callNo}.pdf`)
      toast.success(`Downloaded Call Notice — Call No. ${call.callNo}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to download notice")
    } finally {
      setActionLoading(null)
    }
  }

  const viewNotice = async (call: CapitalCallRow) => {
    setSelectedCallId(call.id)
    setActionLoading(`view-${call.id}`)
    try {
      const docsRes = await lpPortalApi.getCapitalCallDocuments(call.id)
      const doc = docsRes.data[0]
      if (doc?.id) {
        router.push(resolveDocumentHref(doc.id))
        return
      }
      const blob = await lpPortalApi.downloadCapitalCallNotice(call.id)
      const url = URL.createObjectURL(blob)
      window.open(url, "_blank", "noopener,noreferrer")
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open notice")
    } finally {
      setActionLoading(null)
    }
  }

  const downloadStatement = async () => {
    setActionLoading("statement")
    try {
      const blob = await lpPortalApi.downloadDistributionStatement({ fundId, asOfDate })
      downloadBlob(blob, "Distribution-Statement.pdf")
      toast.success("Downloaded distribution statement")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to download statement")
    } finally {
      setActionLoading(null)
    }
  }

  const downloadDistributionPdf = async (row: DistributionRow) => {
    setActionLoading(`dist-${row.id}`)
    try {
      const blob = await lpPortalApi.downloadDistribution(row.id)
      downloadBlob(blob, `${row.ref}.pdf`)
      toast.success(`Downloaded ${row.ref}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to download distribution")
    } finally {
      setActionLoading(null)
    }
  }

  const downloadLinkedDocument = async (docId: string, name: string) => {
    setActionLoading(`doc-${docId}`)
    try {
      const blob = await lpPortalApi.downloadDocument(docId)
      downloadBlob(blob, `${name.replace(/[^\w.-]+/g, "-")}.pdf`)
      toast.success(`Downloaded ${name}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to download document")
    } finally {
      setActionLoading(null)
    }
  }

  const onPaymentConfirmation = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !selectedCall || !canWrite) return
    setActionLoading(`payment-${selectedCall.id}`)
    try {
      const formData = new FormData()
      formData.append("file", file)
      await lpPortalApi.uploadPaymentConfirmation(selectedCall.id, formData, createIdempotencyKey())
      toast.success(`Payment confirmation uploaded for Call No. ${selectedCall.callNo}: ${file.name}`)
      void reloadCalls()
      void reloadCallDetail()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to upload payment confirmation")
    } finally {
      setActionLoading(null)
      event.target.value = ""
    }
  }

  const timelineSteps = React.useMemo(() => {
    if (callDetail?.timeline?.length) {
      return callDetail.timeline.map((step) => ({
        label: step.code.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        detail: step.at ? new Date(step.at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : step.completed ? "Complete" : "Pending",
        state: step.completed ? ("complete" as const) : ("pending" as const),
      }))
    }
    if (!selectedCall) return []
    return [
      { label: "Call Issued", detail: selectedCall.issueDate, state: "complete" as const },
      { label: "Acknowledged", detail: isAcknowledged ? "Confirmed" : "Pending", state: isAcknowledged ? ("complete" as const) : ("pending" as const) },
      { label: "Payment Received", detail: selectedCall.status === "Paid" ? "Matched" : "Pending", state: selectedCall.status === "Paid" ? ("complete" as const) : ("pending" as const) },
      { label: "Call Closed", detail: selectedCall.status === "Paid" ? "Complete" : "Pending", state: selectedCall.status === "Paid" ? ("complete" as const) : ("pending" as const) },
    ]
  }, [callDetail?.timeline, isAcknowledged, selectedCall])

  if (loading && !callsData && !distributionsData) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-72 animate-pulse rounded bg-slate-100" />
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      </div>
    )
  }

  if (error && !callsData && !distributionsData) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight text-slate-950">Capital Calls & Distributions</h1>
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-center">
          <p className="text-sm text-red-700">{error}</p>
          <Button type="button" variant="outline" className="mt-4 rounded-full" onClick={() => { void reloadCalls(); void reloadDistributions() }}>
            Try Again
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4" data-as-of={asOfDate}>
      <input
        ref={paymentInputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.txt"
        className="hidden"
        onChange={onPaymentConfirmation}
      />

      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-950">Capital Calls & Distributions</h1>
        <p className="mt-1 text-sm text-slate-500">
          View and manage capital calls and distributions across your investments.
        </p>
      </div>

      <div className="border-b border-slate-200">
        <div className="flex gap-6">
          {(
            [
              { id: "calls" as const, label: "Capital Calls" },
              { id: "distributions" as const, label: "Distributions" },
            ]
          ).map((tab) => {
            const active = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "-mb-px border-b-2 pb-2.5 text-sm font-semibold transition-colors",
                  active
                    ? "border-[#2563eb] text-[#2563eb]"
                    : "border-transparent text-slate-500 hover:text-slate-700",
                )}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className={cn("grid gap-4", showDetailPanel && "xl:grid-cols-[minmax(0,1fr)_300px]")}>
        <div className="min-w-0 space-y-4">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
            <KpiCard
              icon={<Clock3 className="size-4" strokeWidth={2} />}
              iconBg="bg-[#e8f1ff]"
              iconColor="text-[#2563eb]"
              label="Outstanding Calls"
              value={formatMoneyCompact(summary?.outstanding ?? 0, summary?.currencyCode)}
              footer={`${summary?.openCount ?? 0} Calls`}
              onFooterClick={() => setActiveTab("calls")}
            />
            <KpiCard
              icon={<CheckCircle2 className="size-4" strokeWidth={2} />}
              iconBg="bg-[#e7f8ef]"
              iconColor="text-[#16a34a]"
              label="Paid Calls"
              value={formatMoneyCompact(summary?.paidYtd ?? 0, summary?.currencyCode)}
              footer={`${paidCallCount} Calls`}
              onFooterClick={() => setActiveTab("calls")}
            />
            <KpiCard
              icon={<CalendarDays className="size-4" strokeWidth={2} />}
              iconBg="bg-[#fff1e8]"
              iconColor="text-[#f97316]"
              label="Upcoming Due Amount"
              value={formatMoneyCompact(dueSoonAmount, summary?.currencyCode)}
              footer={`${dueSoonCount} Calls Due`}
              onFooterClick={() => setActiveTab("calls")}
            />
            <KpiCard
              icon={<CircleDollarSign className="size-4" strokeWidth={2} />}
              iconBg="bg-[#f3e8ff]"
              iconColor="text-[#7c3aed]"
              label="Total Distributions"
              value={formatMoneyCompact(totalDistributions, summary?.currencyCode)}
              footer={
                upcomingDistributionNotices
                  ? `${upcomingDistributionNotices.count} Upcoming Notice${upcomingDistributionNotices.count === 1 ? "" : "s"}`
                  : "Since Inception"
              }
              onFooterClick={() => setActiveTab("distributions")}
            />
            <KpiCard
              icon={<FileText className="size-4" strokeWidth={2} />}
              iconBg="bg-[#e6faf8]"
              iconColor="text-[#0d9488]"
              label="Overdue Calls"
              value={formatMoneyCompact(summary?.overdue ?? 0, summary?.currencyCode)}
              footer={`${calls.filter((call) => call.status === "Overdue").length} Overdue`}
              onFooterClick={() => setActiveTab("calls")}
            />
          </div>

          {activeTab === "calls" && (
            <section className="overflow-hidden rounded-xl border border-[#e8edf5] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-1.5">
                  <h2 className="text-[14px] font-semibold text-[#0f172a]">Capital Calls</h2>
                  <Info className="size-3.5 text-[#94a3b8]" aria-hidden />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <OutlineAction
                    disabled={!selectedCall || Boolean(actionLoading)}
                    onClick={() => selectedCall && void viewNotice(selectedCall)}
                  >
                    <Eye className="size-3.5" />
                    View Notice
                  </OutlineAction>
                  <OutlineAction
                    disabled={!selectedCall || Boolean(actionLoading)}
                    onClick={() => selectedCall && void downloadNotice(selectedCall)}
                  >
                    <Download className="size-3.5" />
                    Download Notice
                  </OutlineAction>
                  <PrimaryAction
                    disabled={!selectedCall || isAcknowledged || !canWrite || Boolean(actionLoading)}
                    onClick={() => selectedCall && void acknowledgeCall(selectedCall.id)}
                  >
                    <Download className="size-3.5" />
                    Acknowledge
                  </PrimaryAction>
                  <OutlineAction
                    disabled={!selectedCall || !canWrite || Boolean(actionLoading)}
                    onClick={() => paymentInputRef.current?.click()}
                  >
                    <Sparkles className="size-3.5" />
                    Submit Payment Confirmation
                  </OutlineAction>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[920px] border-collapse text-left text-[12px]">
                  <thead>
                    <tr className="border-b border-[#eef2f7] text-[11px] font-medium text-[#64748b]">
                      <th className="w-11 px-3 py-3" />
                      <th className="whitespace-nowrap px-3 py-3">Call No.</th>
                      <th className="whitespace-nowrap px-3 py-3">Fund</th>
                      <th className="whitespace-nowrap px-3 py-3">Issue Date</th>
                      <th className="whitespace-nowrap px-3 py-3">Due Date</th>
                      <th className="whitespace-nowrap px-3 py-3 text-right">Amount</th>
                      <th className="whitespace-nowrap px-3 py-3 text-right">Paid</th>
                      <th className="whitespace-nowrap px-3 py-3 text-right">Outstanding</th>
                      <th className="whitespace-nowrap px-3 py-3 text-center">Status</th>
                      <th className="w-12 whitespace-nowrap px-3 py-3 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleCalls.map((row) => {
                      const selected = selectedCallId === row.id
                      return (
                        <tr
                          key={row.id}
                          onClick={() => setSelectedCallId(row.id)}
                          className={cn(
                            "cursor-pointer border-b border-[#f1f5f9] transition-colors last:border-0",
                            selected ? "bg-[#eff6ff]" : "bg-white hover:bg-[#f8fafc]",
                          )}
                        >
                          <td className="px-3 py-3">
                            <RadioMarker selected={selected} />
                          </td>
                          <td className="px-3 py-3 font-semibold text-[#0f172a]">{row.callNo}</td>
                          <td className="max-w-[220px] truncate px-3 py-3 text-[#334155]">{row.fund}</td>
                          <td className="whitespace-nowrap px-3 py-3 text-[#475569]">{row.issueDate}</td>
                          <td
                            className={cn(
                              "whitespace-nowrap px-3 py-3",
                              row.dueSoon || row.status === "Overdue"
                                ? "font-semibold text-[#ef4444]"
                                : "text-[#475569]",
                            )}
                          >
                            {row.dueDate}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-[#0f172a]">
                            {money(row.amount)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-[#475569]">
                            {money(row.paid)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums font-medium text-[#0f172a]">
                            {money(row.outstanding)}
                          </td>
                          <td className="px-3 py-3 text-center">
                            <StatusBadge status={row.status} />
                          </td>
                          <td className="px-3 py-3 text-center" onClick={(event) => event.stopPropagation()}>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  type="button"
                                  className="inline-flex size-7 items-center justify-center rounded-full text-[#94a3b8] hover:bg-slate-100 hover:text-slate-600"
                                  aria-label={`Actions for Call No. ${row.callNo}`}
                                >
                                  <MoreHorizontal className="size-4" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-52 rounded-xl">
                                <DropdownMenuItem
                                  onClick={() => {
                                    setSelectedCallId(row.id)
                                    void viewNotice(row)
                                  }}
                                >
                                  <Eye className="size-3.5" />
                                  View Notice
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => void downloadNotice(row)}>
                                  <Download className="size-3.5" />
                                  Download Notice
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={!canWrite || Boolean(acknowledged[row.id] || row.acknowledgedAt) || row.status === "Paid"}
                                  onClick={() => void acknowledgeCall(row.id)}
                                >
                                  <Check className="size-3.5" />
                                  Acknowledge
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={!canWrite}
                                  onClick={() => {
                                    setSelectedCallId(row.id)
                                    window.setTimeout(() => paymentInputRef.current?.click(), 0)
                                  }}
                                >
                                  <FilePenLine className="size-3.5" />
                                  Payment Confirmation
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className="border-t border-[#eef2f7] px-4 py-3">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#2563eb] hover:underline"
                  onClick={() => setShowAllCalls(true)}
                >
                  View all Capital Calls
                  <span aria-hidden>→</span>
                </button>
              </div>
            </section>
          )}

          <section
            className={cn(
              "overflow-hidden rounded-lg border border-slate-200 bg-white",
              activeTab === "distributions" && "ring-1 ring-[#2563eb]/15",
            )}
          >
            <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-1.5">
                <h2 className="text-sm font-semibold text-slate-900">Distributions</h2>
                <Info className="size-3.5 text-slate-400" aria-hidden />
              </div>
              <OutlineAction disabled={Boolean(actionLoading)} onClick={() => void downloadStatement()}>
                <Download className="size-3.5" />
                Download Statement
              </OutlineAction>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-left text-[12px]">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/80 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2.5">Distribution Ref</th>
                    <th className="px-3 py-2.5">Fund</th>
                    <th className="px-3 py-2.5">Type</th>
                    <th className="px-3 py-2.5 text-right">Gross Amount</th>
                    <th className="px-3 py-2.5 text-right">Adjustments</th>
                    <th className="px-3 py-2.5 text-right">Net Paid</th>
                    <th className="px-3 py-2.5">Payment Date</th>
                    <th className="px-3 py-2.5 text-center">Document</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleDistributions.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/80">
                      <td className="px-3 py-2.5 font-semibold text-[#2563eb]">{row.ref}</td>
                      <td className="max-w-[200px] truncate px-3 py-2.5 text-slate-700">{row.fund}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{row.type}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-slate-800">
                        {money(row.gross)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-slate-600">
                        {row.adjustments > 0 ? `(${money(row.adjustments)})` : "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-slate-900">
                        {money(row.netPaid)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{row.paymentDate}</td>
                      <td className="px-3 py-2.5 text-center">
                        <button
                          type="button"
                          className="inline-flex items-center justify-center"
                          aria-label={`Open ${row.ref} document`}
                          onClick={() => {
                            if (row.documentId) router.push(resolveDocumentHref(row.documentId))
                            else void downloadDistributionPdf(row)
                          }}
                        >
                          <PdfIcon />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="border-t border-slate-100 px-4 py-2.5">
              <button
                type="button"
                className="text-[12px] font-semibold text-[#2563eb] hover:underline"
                onClick={() => {
                  setActiveTab("distributions")
                  setShowAllDistributions(true)
                }}
              >
                View all Distributions →
              </button>
            </div>
          </section>
        </div>

        {showDetailPanel && selectedCall && (
          <aside className="h-fit self-start overflow-hidden rounded-xl border border-[#e8edf5] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] xl:sticky xl:top-4">
            <div className="flex items-center justify-between px-4 pb-1 pt-3.5">
              <h2 className="text-[14px] font-semibold text-[#0f172a]">Selected Capital Call</h2>
              <button
                type="button"
                className="inline-flex size-7 items-center justify-center rounded-full text-[#94a3b8] hover:bg-slate-100 hover:text-slate-600"
                aria-label="Close detail"
                onClick={() => setSelectedCallId(null)}
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="px-4 pb-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[15px] font-bold text-[#0f172a]">Call No. {selectedCall.callNo}</p>
                <StatusBadge status={selectedCall.status} />
              </div>
              <p className="mt-1 text-[13px] font-semibold text-[#0f172a]">{selectedCall.fund}</p>

              <div className="mt-3 space-y-0 border-t border-[#eef2f7] pt-1">
                <DetailRow label="Issue Date" value={selectedCall.issueDate} />
                <DetailRow
                  label="Due Date"
                  value={
                    selectedCall.daysUntilDue != null ? (
                      <>
                        {selectedCall.dueDate}{" "}
                        <span className="text-[#ef4444]">(in {selectedCall.daysUntilDue} days)</span>
                      </>
                    ) : (
                      selectedCall.dueDate
                    )
                  }
                  valueClassName={selectedCall.dueSoon ? "font-semibold text-[#ef4444]" : undefined}
                />
                <DetailRow label="Total Amount" value={money(selectedCall.amount)} />
                <DetailRow label="Paid" value={money(selectedCall.paid)} />
                <DetailRow label="Outstanding" value={money(selectedCall.outstanding)} />
              </div>

              {selectedCall.outstanding > 0 && (
                <div className="mt-3 rounded-lg bg-[#eff6ff] px-3 py-3.5 text-center">
                  <p className="text-[12px] font-medium text-[#3b82f6]">Amount Due by {selectedCall.dueDate}</p>
                  <p className="mt-1 text-[22px] font-bold tabular-nums tracking-[-0.02em] text-[#1d4ed8]">
                    {money(selectedCall.outstanding)}
                  </p>
                </div>
              )}

              <div className="mt-4 border-t border-[#eef2f7] pt-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-[13px] font-semibold text-[#0f172a]">Wiring Instructions (preview)</h3>
                  <button
                    type="button"
                    className="shrink-0 text-[11px] font-semibold text-[#2563eb] hover:underline"
                    onClick={() => setWiringDialogOpen(true)}
                  >
                    View full details →
                  </button>
                </div>
                <div className="space-y-0">
                  <DetailRow label="Bank" value={callDetail?.wiring.bankName ?? "—"} />
                  <DetailRow label="Account Name" value={callDetail?.wiring.accountName ?? "—"} />
                  <DetailRow label="Account Number" value={callDetail?.wiring.accountNumberMasked ?? callDetail?.wiring.accountNumber ?? "—"} />
                  <DetailRow label="ABA / Routing" value={callDetail?.wiring.abaRouting ?? "—"} />
                  <div className="flex items-start justify-between gap-2 py-2 text-[12px]">
                    <span className="shrink-0 text-[#64748b]">Reference / Memo</span>
                    <span className="flex max-w-[62%] items-start justify-end gap-1.5 text-right font-semibold leading-4 text-[#0f172a]">
                      <span>{wiringReference}</span>
                      <button
                        type="button"
                        className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[#2563eb] hover:bg-blue-50"
                        aria-label="Copy reference"
                        onClick={copyReference}
                      >
                        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                      </button>
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 border-t border-[#eef2f7] pt-3">
                <div>
                  <h3 className="mb-3 text-[13px] font-semibold text-[#0f172a]">Timeline</h3>
                  <div className="space-y-0">
                    {(
                      timelineSteps
                    ).map((step, index, all) => (
                      <div key={step.label} className="flex gap-2.5">
                        <div className="flex flex-col items-center">
                          <span
                            className={cn(
                              "mt-0.5 flex size-3 items-center justify-center rounded-full",
                              step.state === "complete" && "bg-[#2563eb]",
                              step.state === "pending" && "border-[1.5px] border-[#cbd5e1] bg-white",
                            )}
                          >
                            {step.state === "complete" && <span className="size-1 rounded-full bg-white" />}
                          </span>
                          {index < all.length - 1 && (
                            <span className="my-1 min-h-[18px] w-px flex-1 bg-[#e2e8f0]" />
                          )}
                        </div>
                        <div className={cn(index < all.length - 1 ? "pb-2.5" : "pb-0")}>
                          <p
                            className={cn(
                              "text-[12px] font-semibold leading-4",
                              step.state === "complete" ? "text-[#0f172a]" : "text-[#64748b]",
                            )}
                          >
                            {step.label}
                          </p>
                          <p className="mt-0.5 text-[11px] text-[#94a3b8]">{step.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border-l border-[#eef2f7] pl-3">
                  <h3 className="mb-3 flex items-center gap-1 text-[13px] font-semibold text-[#0f172a]">
                    Acknowledgment Status
                    <Info className="size-3.5 text-[#94a3b8]" aria-hidden />
                  </h3>
                  <div className="flex flex-col items-center pt-2 text-center">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "flex size-7 items-center justify-center rounded-full",
                          isAcknowledged ? "bg-emerald-100 text-emerald-600" : "bg-[#fff7ed] text-[#f97316]",
                        )}
                      >
                        {isAcknowledged ? (
                          <Check className="size-3.5" strokeWidth={2.5} />
                        ) : (
                          <Clock3 className="size-3.5" strokeWidth={2.5} />
                        )}
                      </span>
                      <span className="text-[13px] font-bold text-[#0f172a]">
                        {isAcknowledged ? "Acknowledged" : "Pending"}
                      </span>
                    </div>
                    {!isAcknowledged && canWrite && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={Boolean(actionLoading)}
                        className="mt-3 h-8 w-full rounded-full border-[#93c5fd] bg-white px-3 text-[11px] font-semibold text-[#2563eb] shadow-none hover:bg-[#eff6ff]"
                        onClick={() => void acknowledgeCall(selectedCall.id)}
                      >
                        Acknowledge Call
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-3 border-t border-[#eef2f7] pt-3">
                <h3 className="mb-2.5 text-[13px] font-semibold text-[#0f172a]">Linked Documents</h3>
                <div className="space-y-1">
                  {callDocuments.length > 0 ? (
                    callDocuments.map((doc) => (
                      <div key={doc.id} className="flex items-center gap-2.5 py-1.5">
                        <PdfIcon className="size-5" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12px] font-semibold text-[#2563eb]">
                            <Link href={resolveDocumentHref(doc.id)} className="hover:underline">
                              {doc.name}
                            </Link>
                          </p>
                          <p className="mt-0.5 text-[11px] text-[#94a3b8]">
                            PDF <span className="mx-1">·</span> {doc.publishedDate}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[#2563eb] hover:bg-blue-50"
                          aria-label={`Download ${doc.name}`}
                          disabled={Boolean(actionLoading)}
                          onClick={() => void downloadLinkedDocument(doc.id, doc.name)}
                        >
                          <Download className="size-3.5" />
                        </button>
                      </div>
                    ))
                  ) : (
                    <p className="py-2 text-[12px] text-[#94a3b8]">No linked documents</p>
                  )}
                </div>
              </div>
            </div>
          </aside>
        )}
      </div>

      <Dialog open={wiringDialogOpen} onOpenChange={setWiringDialogOpen}>
        <DialogContent className="max-w-lg rounded-xl">
          <DialogHeader>
            <DialogTitle>Wiring instructions</DialogTitle>
            <DialogDescription>
              Call No. {selectedCall?.callNo} · {selectedCall?.fund}
            </DialogDescription>
          </DialogHeader>
          {callDetail?.wiring.raw ? (
            <pre className="max-h-[50vh] overflow-auto rounded-lg border border-[#e5e7eb] bg-[#f9fafb] p-3 text-[11px] leading-5 whitespace-pre-wrap text-[#374151]">
              {callDetail.wiring.raw}
            </pre>
          ) : callDetail?.wiring ? (
            <dl className="space-y-2 text-[12px]">
              {[
                ["Bank", callDetail.wiring.bankName],
                ["Account name", callDetail.wiring.accountName],
                ["Account number", callDetail.wiring.accountNumber ?? callDetail.wiring.accountNumberMasked],
                ["ABA / Routing", callDetail.wiring.abaRouting],
                ["Reference / Memo", callDetail.wiring.reference],
              ].map(([label, value]) => (
                <div key={label} className="grid grid-cols-[120px_1fr] gap-2">
                  <dt className="text-[#64748b]">{label}</dt>
                  <dd className="font-medium text-[#0f172a]">{value || "—"}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-[13px] text-[#6b7280]">Wiring details are not available for this call.</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
