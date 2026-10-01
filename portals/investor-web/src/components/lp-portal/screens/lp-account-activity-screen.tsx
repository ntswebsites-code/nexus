"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  FileText,
  Receipt,
  RefreshCcw,
  SlidersHorizontal,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useLpFundScope, useLpPortal } from "@/components/lp-portal/lp-portal-context"
import { InfoHint } from "@/components/lp-portal/info-hint"
import { lpPortalApi, type LpLedgerDetail } from "@/lib/api/lp-portal-api"
import { downloadBlob, formatDate, formatFileSize, formatMoneyCompact } from "@/lib/lp-portal/format"
import { resolveDocumentHref } from "@/lib/lp-portal/navigation"
import { useLpAccountActivity } from "@/lib/lp-portal/hooks"
import { getApiErrorMessage } from "@/lib/lp-portal/use-lp-api"
import { cn } from "@/lib/utils"

type TxStatus = "Posted" | "Settled" | "Under Review" | "Pending"
type TxKind =
  | "contribution"
  | "distribution"
  | "subscription"
  | "redemption"
  | "fee"
  | "net"

type ActivityRow = {
  id: string
  transactionDate: string
  effectiveDate: string
  fund: string
  type: string
  kind: Exclude<TxKind, "net">
  reference: string
  currency: string
  originalAmount: number
  reportingAmount: number
  exchangeRate: number
  status: TxStatus
  structure: "LP" | "Open-End" | "Credit"
  investor: string
  postedDate: string
  postedBy: string
  notes: string
  documents: Array<{ name: string; date: string; size: string }>
  fxNote: string
}

const KIND_META: Record<
  Exclude<TxKind, "net">,
  { label: string; iconBg: string; iconColor: string; icon: React.ReactNode }
> = {
  contribution: {
    label: "Contributions",
    iconBg: "bg-[#dbeafe]",
    iconColor: "text-[#2563eb]",
    icon: <ArrowDownToLine className="size-3.5" strokeWidth={2.25} />,
  },
  distribution: {
    label: "Distributions",
    iconBg: "bg-[#dcfce7]",
    iconColor: "text-[#16a34a]",
    icon: <ArrowUpFromLine className="size-3.5" strokeWidth={2.25} />,
  },
  subscription: {
    label: "Subscriptions",
    iconBg: "bg-[#ede9fe]",
    iconColor: "text-[#7c3aed]",
    icon: <Receipt className="size-3.5" strokeWidth={2.25} />,
  },
  redemption: {
    label: "Redemptions",
    iconBg: "bg-[#ffedd5]",
    iconColor: "text-[#ea580c]",
    icon: <RefreshCcw className="size-3.5" strokeWidth={2.25} />,
  },
  fee: {
    label: "Fees",
    iconBg: "bg-[#fee2e2]",
    iconColor: "text-[#dc2626]",
    icon: <FileText className="size-3.5" strokeWidth={2.25} />,
  },
}

function buildKpiCards(rows: ActivityRow[]) {
  const kinds: Array<Exclude<TxKind, "net">> = [
    "contribution",
    "distribution",
    "subscription",
    "redemption",
    "fee",
  ]
  const cards = kinds.map((kind) => {
    const subset = rows.filter((row) => row.kind === kind)
    const total = subset.reduce((sum, row) => sum + row.reportingAmount, 0)
    return {
      id: kind as TxKind,
      label: KIND_META[kind].label,
      value: formatMoneyCompact(total),
      count: subset.length,
      iconBg: KIND_META[kind].iconBg,
      iconColor: KIND_META[kind].iconColor,
      icon: KIND_META[kind].icon,
    }
  })
  const netTotal = rows.reduce((sum, row) => {
    if (row.kind === "contribution" || row.kind === "subscription") return sum + row.reportingAmount
    if (row.kind === "distribution" || row.kind === "redemption" || row.kind === "fee") {
      return sum - row.reportingAmount
    }
    return sum
  }, 0)
  cards.push({
    id: "net" as TxKind,
    label: "Net Cash Flow",
    value: formatMoneyCompact(netTotal),
    count: rows.length,
    iconBg: "bg-[#ccfbf1]",
    iconColor: "text-[#0d9488]",
    icon: <ArrowUpFromLine className="size-4 -rotate-45" strokeWidth={2.25} />,
  })
  return cards
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function InfoHintKpi({ label }: { label: string }) {
  const descriptions: Record<string, string> = {
    Contributions: "Capital paid into fund commitments.",
    Distributions: "Cash returned from fund investments.",
    Subscriptions: "Open-ended fund purchase requests.",
    Redemptions: "Open-ended fund redemption requests.",
    Fees: "Management and administrative charges.",
    "Net Cash Flow": "Net of inflows and outflows in reporting currency.",
  }
  return <InfoHint label={label} description={descriptions[label]} />
}

function StatusBadge({ status }: { status: TxStatus }) {
  const styles: Record<TxStatus, string> = {
    Posted: "bg-[#dcfce7] text-[#15803d]",
    Settled: "bg-[#dbeafe] text-[#1d4ed8]",
    "Under Review": "bg-[#ffedd5] text-[#c2410c]",
    Pending: "bg-[#fef9c3] text-[#a16207]",
  }
  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
        styles[status],
      )}
    >
      {status}
    </span>
  )
}

function FilterField({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="min-w-0">
      <label className="mb-1.5 block text-[11px] font-semibold text-[#374151]">{label}</label>
      {children}
    </div>
  )
}

export function LpAccountActivityScreen({
  initialStructure = "all",
  initialEntryId,
}: {
  initialStructure?: string
  initialEntryId?: string
}) {
  const router = useRouter()
  const { fundId, asOfDate } = useLpFundScope()
  const { funds } = useLpPortal()
  const [fromDate, setFromDate] = React.useState("")
  const { data, loading, error, reload } = useLpAccountActivity(fromDate || undefined)
  const allRows = data?.items ?? []

  const [metric, setMetric] = React.useState<TxKind | "all">("all")
  const [fund, setFund] = React.useState("all")
  const [txType, setTxType] = React.useState("all")
  const [currency, setCurrency] = React.useState("all")
  const [structure, setStructure] = React.useState(() => {
    if (initialStructure === "private-capital") return "LP"
    if (initialStructure === "open-ended") return "Open-End"
    return "all"
  })
  const [status, setStatus] = React.useState("all")
  const [moreFiltersOpen, setMoreFiltersOpen] = React.useState(false)
  const [investorFilter, setInvestorFilter] = React.useState("all")
  const [referenceFilter, setReferenceFilter] = React.useState("")
  const [postedByFilter, setPostedByFilter] = React.useState("all")
  const [minAmount, setMinAmount] = React.useState("")
  const [maxAmount, setMaxAmount] = React.useState("")
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(15)
  const [selectedId, setSelectedId] = React.useState<string | null>(initialEntryId ?? null)
  const [ledgerDetail, setLedgerDetail] = React.useState<LpLedgerDetail | null>(null)
  const [ledgerLoading, setLedgerLoading] = React.useState(false)
  const [exporting, setExporting] = React.useState<string | null>(null)

  const dateRangeLabel = fromDate
    ? `${formatDate(fromDate, "long")} – ${formatDate(asOfDate, "long")}`
    : asOfDate
      ? `Through ${formatDate(asOfDate, "long")}`
      : "All dates"

  const kpiCards = React.useMemo(() => buildKpiCards(allRows), [allRows])

  React.useEffect(() => {
    setStructure(
      initialStructure === "private-capital"
        ? "LP"
        : initialStructure === "open-ended"
          ? "Open-End"
          : "all",
    )
  }, [initialStructure])

  const filteredRows = React.useMemo(() => {
    return allRows.filter((row) => {
      if (metric !== "all" && metric !== "net" && row.kind !== metric) return false
      if (fund !== "all" && row.fund !== fund) return false
      if (txType !== "all" && row.type !== txType) return false
      if (currency !== "all" && row.currency !== currency) return false
      if (structure !== "all" && row.structure !== structure) return false
      if (status !== "all" && row.status !== status) return false
      if (investorFilter !== "all" && row.investor !== investorFilter) return false
      if (referenceFilter.trim() && !row.reference.toLowerCase().includes(referenceFilter.trim().toLowerCase())) {
        return false
      }
      if (postedByFilter !== "all" && row.postedBy !== postedByFilter) return false
      const min = minAmount.trim() ? Number(minAmount) : null
      const max = maxAmount.trim() ? Number(maxAmount) : null
      if (min != null && !Number.isNaN(min) && row.reportingAmount < min) return false
      if (max != null && !Number.isNaN(max) && row.reportingAmount > max) return false
      return true
    })
  }, [
    allRows,
    currency,
    fund,
    investorFilter,
    maxAmount,
    metric,
    minAmount,
    postedByFilter,
    referenceFilter,
    status,
    structure,
    txType,
  ])

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageStart = (safePage - 1) * pageSize
  const pageRows = filteredRows.slice(pageStart, pageStart + pageSize)
  const selected = filteredRows.find((row) => row.id === selectedId) ?? null

  const drawerDocuments = React.useMemo<Array<{ id?: string; name: string; date: string; size: string }>>(() => {
    if (ledgerDetail?.documents?.length) {
      return ledgerDetail.documents.map((doc) => ({
        id: doc.id,
        name: doc.name,
        date: formatDate(doc.publishedDate),
        size: formatFileSize(doc.size),
      }))
    }
    return selected?.documents ?? []
  }, [ledgerDetail?.documents, selected?.documents])

  React.useEffect(() => {
    if (initialEntryId) setSelectedId(initialEntryId)
  }, [initialEntryId])

  React.useEffect(() => {
    if (safePage !== page) setPage(safePage)
  }, [page, safePage])

  React.useEffect(() => {
    if (!selectedId) {
      setLedgerDetail(null)
      return
    }
    setLedgerLoading(true)
    lpPortalApi
      .getLedgerEntry(selectedId)
      .then((res) => setLedgerDetail(res.data))
      .catch((err) => {
        setLedgerDetail(null)
        toast.error(getApiErrorMessage(err, "Could not load transaction detail"))
      })
      .finally(() => setLedgerLoading(false))
  }, [selectedId])

  React.useEffect(() => {
    if (selectedId && !filteredRows.some((row) => row.id === selectedId)) {
      setSelectedId(filteredRows[0]?.id ?? null)
    }
  }, [filteredRows, selectedId])

  React.useEffect(() => {
    if (!selectedId && filteredRows[0]) setSelectedId(filteredRows[0].id)
  }, [filteredRows, selectedId])

  const clearFilters = () => {
    setMetric("all")
    setFund("all")
    setTxType("all")
    setCurrency("all")
    setStructure("all")
    setStatus("all")
    setFromDate("")
    setInvestorFilter("all")
    setReferenceFilter("")
    setPostedByFilter("all")
    setMinAmount("")
    setMaxAmount("")
    setPage(1)
    toast.message("Filters cleared")
  }

  const advancedFilterCount = [
    investorFilter !== "all",
    referenceFilter.trim().length > 0,
    postedByFilter !== "all",
    minAmount.trim().length > 0,
    maxAmount.trim().length > 0,
  ].filter(Boolean).length

  const exportRows = async (format: "csv" | "excel" | "pdf") => {
    const apiFormat = format === "excel" ? "xlsx" : format
    setExporting(format)
    try {
      const blob = await lpPortalApi.exportAccountActivity({
        fundId,
        from: fromDate || undefined,
        to: asOfDate,
        format: apiFormat,
      })
      const ext = apiFormat === "xlsx" ? "xlsx" : apiFormat
      downloadBlob(blob, `account-activity.${ext}`)
      toast.success(`${format.toUpperCase()} exported.`)
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Export failed"))
    } finally {
      setExporting(null)
    }
  }

  const fundOptions = React.useMemo(() => {
    const fromRows = Array.from(new Set(allRows.map((r) => r.fund)))
    if (fromRows.length) return fromRows
    return funds.map((f) => f.name)
  }, [allRows, funds])

  const types = Array.from(new Set(allRows.map((r) => r.type)))
  const investors = Array.from(new Set(allRows.map((r) => r.investor).filter(Boolean)))
  const postedByOptions = Array.from(new Set(allRows.map((r) => r.postedBy).filter(Boolean)))

  const pageNumbers = React.useMemo(() => {
    const max = Math.min(totalPages, 5)
    if (totalPages <= 5) return Array.from({ length: totalPages }, (_, i) => i + 1)
    if (safePage <= 3) return [1, 2, 3, 4, 5]
    if (safePage >= totalPages - 2) {
      return [totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
    }
    return [safePage - 2, safePage - 1, safePage, safePage + 1, safePage + 2]
  }, [safePage, totalPages])

  return (
    <div className="space-y-5 pb-8">
      {error ? (
        <div className="rounded-xl border border-[#fecaca] bg-[#fef2f2] p-4 text-center">
          <p className="text-[13px] text-[#dc2626]">{error}</p>
          <Button type="button" className="mt-3 rounded-full" onClick={() => void reload()}>
            Retry
          </Button>
        </div>
      ) : null}

      <div>
        <h1 className="text-[24px] font-bold tracking-tight text-[#0f172a]">Account Activity</h1>
        <p className="mt-1.5 text-[13px] leading-5 text-[#6b7280]">
          Detailed view of all transactions across your investments
        </p>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpiCards.map((card) => {
          const active = metric === card.id
          return (
            // The hint is a sibling of the card button, not a child: InfoHintKpi renders its own
            // <button> as the popover trigger, and a <button> inside a <button> is invalid HTML —
            // React reported it as a hydration error on every load of this screen. Positioned
            // absolutely so the card looks exactly as before.
            <div key={card.id} className="relative">
            <button
              type="button"
              onClick={() => {
                if (card.id === "net") {
                  setMetric(metric === "net" ? "all" : "net")
                } else {
                  setMetric(metric === card.id ? "all" : card.id)
                }
                setPage(1)
              }}
              className={cn(
                "block w-full rounded-xl border bg-white p-3.5 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition",
                active ? "border-[#93c5fd] ring-2 ring-[#bfdbfe]" : "border-[#e5e7eb] hover:border-[#cbd5e1]",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-full",
                      card.iconBg,
                      card.iconColor,
                    )}
                  >
                    {card.icon}
                  </span>
                  <p className="text-[12px] font-medium text-[#6b7280]">{card.label}</p>
                </div>
              </div>
              <p className="mt-3 text-[20px] font-bold tabular-nums tracking-[-0.03em] text-[#0f172a]">
                {card.value}
              </p>
              <span className="mt-2 inline-block text-[12px] font-medium text-[#2563eb]">
                {card.count} Transactions
              </span>
            </button>
            <div className="absolute right-3.5 top-3.5">
              <InfoHintKpi label={card.label} />
            </div>
            </div>
          )
        })}
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-[#e5e7eb] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="grid gap-3 lg:grid-cols-[repeat(6,minmax(0,1fr))_auto_auto] lg:items-end">
          <FilterField label="Fund">
            <Select value={fund} onValueChange={(v) => { setFund(v); setPage(1) }}>
              <SelectTrigger className="h-9 w-full rounded-lg border-[#e5e7eb] bg-white text-[12px] shadow-none">
                <SelectValue placeholder="All Funds" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Funds</SelectItem>
                {fundOptions.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="Transaction Type">
            <Select value={txType} onValueChange={(v) => { setTxType(v); setPage(1) }}>
              <SelectTrigger className="h-9 w-full rounded-lg border-[#e5e7eb] bg-white text-[12px] shadow-none">
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {types.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="Date Range">
            <div className="flex h-9 items-center gap-2 rounded-lg border border-[#e5e7eb] bg-white px-3 text-[12px] text-[#0f172a]">
              <input
                type="date"
                value={fromDate}
                onChange={(e) => {
                  setFromDate(e.target.value)
                  setPage(1)
                }}
                className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[12px] outline-none"
                aria-label="From date"
              />
              <span className="shrink-0 text-[#9ca3af]">to</span>
              <span className="truncate text-[#64748b]">{formatDate(asOfDate, "short")}</span>
            </div>
          </FilterField>

          <FilterField label="Currency">
            <Select value={currency} onValueChange={(v) => { setCurrency(v); setPage(1) }}>
              <SelectTrigger className="h-9 w-full rounded-lg border-[#e5e7eb] bg-white text-[12px] shadow-none">
                <SelectValue placeholder="All Currencies" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Currencies</SelectItem>
                <SelectItem value="USD">USD</SelectItem>
                <SelectItem value="EUR">EUR</SelectItem>
                <SelectItem value="GBP">GBP</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="Structure">
            <Select value={structure} onValueChange={(v) => { setStructure(v); setPage(1) }}>
              <SelectTrigger className="h-9 w-full rounded-lg border-[#e5e7eb] bg-white text-[12px] shadow-none">
                <SelectValue placeholder="All Structures" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Structures</SelectItem>
                <SelectItem value="LP">LP</SelectItem>
                <SelectItem value="Open-End">Open-End</SelectItem>
                <SelectItem value="Credit">Credit</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="Status">
            <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1) }}>
              <SelectTrigger className="h-9 w-full rounded-lg border-[#e5e7eb] bg-white text-[12px] shadow-none">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="Posted">Posted</SelectItem>
                <SelectItem value="Settled">Settled</SelectItem>
                <SelectItem value="Under Review">Under Review</SelectItem>
                <SelectItem value="Pending">Pending</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>

          <Button
            type="button"
            variant="outline"
            className="relative h-9 rounded-full border-[#e5e7eb] px-4 text-[12px] font-medium text-[#374151] shadow-none"
            onClick={() => setMoreFiltersOpen(true)}
          >
            <SlidersHorizontal className="size-3.5" />
            More Filters
            {advancedFilterCount > 0 ? (
              <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-[#2563eb] text-[9px] font-bold text-white">
                {advancedFilterCount}
              </span>
            ) : null}
          </Button>

          <button
            type="button"
            className="h-9 text-[12px] font-medium text-[#2563eb] hover:text-[#1d4ed8]"
            onClick={clearFilters}
          >
            Clear All
          </button>
        </div>
      </div>

      <Dialog open={moreFiltersOpen} onOpenChange={setMoreFiltersOpen}>
        <DialogContent className="max-w-md rounded-xl">
          <DialogHeader>
            <DialogTitle>More filters</DialogTitle>
            <DialogDescription>
              Narrow transactions by investor, reference, poster, or amount range.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <FilterField label="Investor">
              <Select value={investorFilter} onValueChange={setInvestorFilter}>
                <SelectTrigger className="h-9 w-full rounded-lg border-[#e5e7eb] bg-white text-[12px] shadow-none">
                  <SelectValue placeholder="All investors" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All investors</SelectItem>
                  {investors.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Reference contains">
              <Input
                value={referenceFilter}
                onChange={(e) => setReferenceFilter(e.target.value)}
                placeholder="e.g. CC-2024-07"
                className="h-9 rounded-lg border-[#e5e7eb] text-[12px] shadow-none"
              />
            </FilterField>
            <FilterField label="Posted by">
              <Select value={postedByFilter} onValueChange={setPostedByFilter}>
                <SelectTrigger className="h-9 w-full rounded-lg border-[#e5e7eb] bg-white text-[12px] shadow-none">
                  <SelectValue placeholder="Anyone" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Anyone</SelectItem>
                  {postedByOptions.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
            <div className="grid grid-cols-2 gap-3">
              <FilterField label="Min amount">
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={minAmount}
                  onChange={(e) => setMinAmount(e.target.value)}
                  placeholder="0.00"
                  className="h-9 rounded-lg border-[#e5e7eb] text-[12px] shadow-none"
                />
              </FilterField>
              <FilterField label="Max amount">
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={maxAmount}
                  onChange={(e) => setMaxAmount(e.target.value)}
                  placeholder="No limit"
                  className="h-9 rounded-lg border-[#e5e7eb] text-[12px] shadow-none"
                />
              </FilterField>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              className="rounded-full"
              onClick={() => {
                setInvestorFilter("all")
                setReferenceFilter("")
                setPostedByFilter("all")
                setMinAmount("")
                setMaxAmount("")
              }}
            >
              Reset
            </Button>
            <Button
              type="button"
              className="rounded-full"
              onClick={() => {
                setPage(1)
                setMoreFiltersOpen(false)
              }}
            >
              Apply filters
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Table + detail */}
      <div
        className={cn(
          "grid items-start gap-4",
          selected ? "xl:grid-cols-[minmax(0,1fr)_340px]" : "grid-cols-1",
        )}
      >
        <section className="min-w-0 overflow-hidden rounded-xl border border-[#e5e7eb] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#f1f5f9] px-4 py-3">
            <p className="text-[12px] text-[#6b7280]">
              Showing{" "}
              <span className="font-medium text-[#111827]">
                {filteredRows.length === 0 ? 0 : pageStart + 1}
              </span>{" "}
              to{" "}
              <span className="font-medium text-[#111827]">
                {Math.min(pageStart + pageSize, filteredRows.length)}
              </span>{" "}
              of <span className="font-medium text-[#111827]">{filteredRows.length}</span> transactions
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-8 rounded-full border-[#e5e7eb] px-3 text-[11px] font-medium text-[#374151] shadow-none"
                onClick={() => void exportRows("csv")}
                disabled={Boolean(exporting)}
              >
                <FileSpreadsheet className="size-3.5 text-[#16a34a]" />
                Export CSV
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-8 rounded-full border-[#e5e7eb] px-3 text-[11px] font-medium text-[#374151] shadow-none"
                onClick={() => void exportRows("excel")}
                disabled={Boolean(exporting)}
              >
                <FileSpreadsheet className="size-3.5 text-[#2563eb]" />
                Export Excel
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-8 rounded-full border-[#e5e7eb] px-3 text-[11px] font-medium text-[#374151] shadow-none"
                onClick={() => void exportRows("pdf")}
                disabled={Boolean(exporting)}
              >
                <FileText className="size-3.5 text-[#dc2626]" />
                Export PDF
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-left text-[12px]">
              <thead>
                <tr className="border-b border-[#e5e7eb] bg-[#fafafa] text-[11px] font-semibold text-[#6b7280]">
                  <th className="whitespace-nowrap px-4 py-2.5">Transaction Date ↓</th>
                  <th className="whitespace-nowrap px-3 py-2.5">Effective Date</th>
                  <th className="whitespace-nowrap px-3 py-2.5">Fund</th>
                  <th className="whitespace-nowrap px-3 py-2.5">Type</th>
                  <th className="whitespace-nowrap px-3 py-2.5">Reference</th>
                  <th className="whitespace-nowrap px-3 py-2.5">Currency</th>
                  <th className="whitespace-nowrap px-3 py-2.5 text-right">Original Amount</th>
                  <th className="whitespace-nowrap px-3 py-2.5 text-right">Reporting Amount</th>
                  <th className="whitespace-nowrap px-3 py-2.5 text-right">Exchange Rate</th>
                  <th className="whitespace-nowrap px-3 py-2.5">Status</th>
                  <th className="whitespace-nowrap px-4 py-2.5 text-center">Document</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-10 text-center text-[13px] text-[#9ca3af]">
                      Loading account activity…
                    </td>
                  </tr>
                ) : (
                  pageRows.map((row) => {
                  const kind = KIND_META[row.kind]
                  const isSelected = selected?.id === row.id
                  return (
                    <tr
                      key={row.id}
                      onClick={() => setSelectedId(row.id)}
                      className={cn(
                        "cursor-pointer border-b border-[#f3f4f6] transition last:border-0",
                        isSelected
                          ? "bg-[#eff6ff] shadow-[inset_3px_0_0_0_#2563eb]"
                          : "hover:bg-[#f9fafb]",
                      )}
                    >
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-[#2563eb]">
                        {row.transactionDate}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-[#4b5563]">{row.effectiveDate}</td>
                      <td className="max-w-[180px] truncate px-3 py-3 font-medium text-[#111827]">
                        {row.fund}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        <span className="inline-flex items-center gap-1.5 text-[#374151]">
                          <span
                            className={cn(
                              "flex size-5 items-center justify-center rounded-full",
                              kind.iconBg,
                              kind.iconColor,
                            )}
                          >
                            {kind.icon}
                          </span>
                          {row.type}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 font-mono text-[11px] text-[#4b5563]">
                        {row.reference}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-[#4b5563]">{row.currency}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-[#111827]">
                        {money(row.originalAmount)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums font-medium text-[#111827]">
                        {money(row.reportingAmount)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-[#4b5563]">
                        {row.exchangeRate.toFixed(4)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        <StatusBadge status={row.status} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        {ledgerDetail?.callNoticeDocumentId && selected?.id === row.id ? (
                          <button
                            type="button"
                            className="inline-flex text-[#dc2626] hover:opacity-80"
                            aria-label={`Document for ${row.reference}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              router.push(resolveDocumentHref(ledgerDetail.callNoticeDocumentId!))
                            }}
                          >
                            <FileText className="size-4" />
                          </button>
                        ) : (
                          <span className="text-[#d1d5db]">—</span>
                        )}
                      </td>
                    </tr>
                  )
                  })
                )}
                {!loading && pageRows.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-4 py-10 text-center text-[13px] text-[#9ca3af]">
                      No transactions match the selected filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#f1f5f9] px-4 py-3">
            <div className="flex items-center gap-2 text-[12px] text-[#6b7280]">
              <span>Rows per page</span>
              <Select
                value={String(pageSize)}
                onValueChange={(v) => {
                  setPageSize(Number(v))
                  setPage(1)
                }}
              >
                <SelectTrigger className="h-8 w-[72px] rounded-lg border-[#e5e7eb] text-[12px] shadow-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[10, 15, 25, 50].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={safePage <= 1}
                className="flex size-8 items-center justify-center rounded-lg border border-[#e5e7eb] text-[#6b7280] disabled:opacity-40"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                aria-label="Previous page"
              >
                <ChevronLeft className="size-4" />
              </button>
              {pageNumbers.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setPage(n)}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-lg text-[12px] font-medium",
                    n === safePage
                      ? "bg-[#2563eb] text-white"
                      : "border border-[#e5e7eb] text-[#374151] hover:bg-[#f9fafb]",
                  )}
                >
                  {n}
                </button>
              ))}
              <button
                type="button"
                disabled={safePage >= totalPages}
                className="flex size-8 items-center justify-center rounded-lg border border-[#e5e7eb] text-[#6b7280] disabled:opacity-40"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                aria-label="Next page"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          </div>
        </section>

        {selected && (
          <aside className="sticky top-4 overflow-hidden rounded-xl border border-[#e5e7eb] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="flex items-center justify-between border-b border-[#f1f5f9] px-4 py-3">
              <h2 className="text-[13px] font-semibold text-[#111827]">Transaction Details</h2>
              <button
                type="button"
                className="rounded-full p-1 text-[#9ca3af] hover:bg-[#f3f4f6] hover:text-[#4b5563]"
                onClick={() => setSelectedId(null)}
                aria-label="Close details"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="max-h-[calc(100vh-8rem)] space-y-5 overflow-y-auto px-4 py-4">
              <div className="flex items-start gap-3">
                <span
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-full",
                    KIND_META[selected.kind].iconBg,
                    KIND_META[selected.kind].iconColor,
                  )}
                >
                  {KIND_META[selected.kind].icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[14px] font-semibold text-[#111827]">{selected.type}</p>
                    <StatusBadge status={selected.status} />
                  </div>
                  <p className="mt-1 text-[12px] text-[#6b7280]">Reference: {selected.reference}</p>
                </div>
              </div>

              <dl className="space-y-2.5 text-[12px]">
                {[
                  ["Transaction Date", selected.transactionDate],
                  ["Effective Date", selected.effectiveDate],
                  ["Fund", selected.fund],
                  ["Structure", selected.structure],
                  ["Investor", selected.investor],
                  ["Currency", selected.currency],
                  ["Original Amount", money(selected.originalAmount)],
                  ["Reporting Amount", money(selected.reportingAmount)],
                  ["Exchange Rate", selected.exchangeRate.toFixed(4)],
                  ["Status", selected.status],
                  ["Posted Date", selected.postedDate],
                  ["Posted By", selected.postedBy],
                ].map(([label, value]) => (
                  <div key={label} className="grid grid-cols-[120px_1fr] gap-2">
                    <dt className="text-[#9ca3af]">{label}</dt>
                    <dd className="font-medium text-[#111827]">{value}</dd>
                  </div>
                ))}
              </dl>

              {ledgerLoading ? (
                <p className="text-[12px] text-[#9ca3af]">Loading allocation details…</p>
              ) : ledgerDetail?.allocation ? (
                <div>
                  <h3 className="text-[12px] font-semibold text-[#111827]">Capital Call Allocation</h3>
                  <dl className="mt-2 space-y-2 text-[12px]">
                    {[
                      ["Call Amount", ledgerDetail.allocation.currentCallAmount],
                      ["Amount Paid", ledgerDetail.allocation.amountPaid],
                      ["Status", ledgerDetail.allocation.status],
                    ].map(([label, value]) => (
                      <div key={label} className="grid grid-cols-[120px_1fr] gap-2">
                        <dt className="text-[#9ca3af]">{label}</dt>
                        <dd className="font-medium text-[#111827]">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : null}

              {drawerDocuments.length > 0 ? (
                <div>
                  <h3 className="text-[12px] font-semibold text-[#111827]">
                    Linked Documents ({drawerDocuments.length})
                  </h3>
                  <div className="mt-2 space-y-2">
                    {drawerDocuments.map((doc) => (
                      <div
                        key={doc.id ?? doc.name}
                        className="flex items-center gap-2 rounded-lg border border-[#e5e7eb] px-2.5 py-2"
                      >
                        <FileText className="size-4 shrink-0 text-[#dc2626]" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[11px] font-medium text-[#111827]">{doc.name}</p>
                          <p className="text-[10px] text-[#9ca3af]">
                            {doc.date} · {doc.size}
                          </p>
                        </div>
                        {"id" in doc && doc.id ? (
                          <>
                            <button
                              type="button"
                              className="rounded-full p-1.5 text-[#2563eb] hover:bg-[#eff6ff]"
                              aria-label={`Open ${doc.name}`}
                              onClick={() => router.push(resolveDocumentHref(doc.id!))}
                            >
                              <FileText className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              className="rounded-full p-1.5 text-[#2563eb] hover:bg-[#eff6ff]"
                              aria-label={`Download ${doc.name}`}
                              onClick={() => {
                                void lpPortalApi.downloadDocument(doc.id!).then((blob) => {
                                  downloadBlob(blob, doc.name)
                                  toast.success("Document downloaded.")
                                }).catch((err) => {
                                  toast.error(getApiErrorMessage(err, "Download failed"))
                                })
                              }}
                            >
                              <Download className="size-3.5" />
                            </button>
                          </>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : ledgerDetail?.callNoticeDocumentId ? (
                <div>
                  <h3 className="text-[12px] font-semibold text-[#111827]">Linked Documents</h3>
                  <Link
                    href={resolveDocumentHref(ledgerDetail.callNoticeDocumentId)}
                    className="mt-2 inline-flex text-[12px] font-medium text-[#2563eb] hover:underline"
                  >
                    Open call notice document
                  </Link>
                </div>
              ) : null}

              <div>
                <h3 className="text-[12px] font-semibold text-[#111827]">FX Details</h3>
                <div className="mt-2 flex items-center gap-2 rounded-lg border border-[#e5e7eb] bg-[#f9fafb] px-3 py-2.5 text-[12px] text-[#4b5563]">
                  <span className="flex size-6 items-center justify-center rounded-full bg-[#e0e7ff] text-[10px] font-bold uppercase text-[#4338ca]">
                    fx
                  </span>
                  {selected.fxNote}
                </div>
              </div>

              <div>
                <h3 className="text-[12px] font-semibold text-[#111827]">Notes</h3>
                <p className="mt-2 rounded-lg border border-[#e5e7eb] bg-[#f9fafb] px-3 py-2.5 text-[12px] leading-5 text-[#4b5563]">
                  {selected.notes}
                </p>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
