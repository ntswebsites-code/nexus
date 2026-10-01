"use client"

import * as React from "react"
import Link from "next/link"
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  CircleDollarSign,
  Crosshair,
  DollarSign,
  Download,
  FileCheck2,
  FilePlus2,
  FileText,
  Gauge,
  Info,
  ShieldCheck,
  TrendingUp,
} from "lucide-react"
import {
  Area,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useLpFundScope, useLpPortal } from "@/components/lp-portal/lp-portal-context"
import { lpPortalApi, type LpDashboardAction } from "@/lib/api/lp-portal-api"
import {
  downloadBlob,
  formatMoney,
  formatMoneyCompact,
  formatMultiple,
  formatPercent,
  formatUnits,
  niceAxisMax,
  parseDecimal,
} from "@/lib/lp-portal/format"
import { useLpDashboardBundle } from "@/lib/lp-portal/hooks"
import {
  mapDashboardAction,
  mapDocumentRow,
  mapHistoryChartPoint,
  mapOpenEndedHistoryPoint,
  mapRecentActivityRow,
} from "@/lib/lp-portal/mappers"
import { cn } from "@/lib/utils"

type ChartPeriod = "SI" | "3Y" | "1Y" | "YTD"

const periods: Array<{ id: ChartPeriod; label: string }> = [
  { id: "SI", label: "Since Inception" },
  { id: "3Y", label: "3Y" },
  { id: "1Y", label: "1Y" },
  { id: "YTD", label: "YTD" },
]

function pctOf(part: string, total: string): string {
  const t = parseDecimal(total)
  if (t <= 0) return "—"
  return `${((parseDecimal(part) / t) * 100).toFixed(1)}% of Commitment`
}

function actionIcon(type: string) {
  const upper = type.toUpperCase()
  if (upper.includes("CAPITAL_CALL")) return ArrowDownToLine
  if (upper.includes("SUBSCRIPTION") || upper.includes("DOCUMENT") || upper.includes("SIGN")) return FileCheck2
  if (upper.includes("KYC") || upper.includes("COMPLIANCE")) return ShieldCheck
  return FileText
}

function actionTone(severity: string): "red" | "orange" | "blue" {
  const upper = severity.toUpperCase()
  if (upper === "HIGH" || upper === "CRITICAL") return "red"
  if (upper === "MEDIUM" || upper === "WARNING") return "orange"
  return "blue"
}

function actionDisplayLabel(action: LpDashboardAction): string {
  const upper = action.type.toUpperCase()
  if (upper.includes("SUBSCRIPTION") || upper.includes("SIGN")) return "Review & Sign"
  if (upper.includes("KYC")) return "Update"
  return action.type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

function Panel({
  children,
  className,
  id,
}: {
  children: React.ReactNode
  className?: string
  id?: string
}) {
  return (
    <section
      id={id}
      className={cn(
        "rounded-xl border border-[#e5e7eb] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
        className,
      )}
    >
      {children}
    </section>
  )
}

function PanelHeader({
  title,
  subtitle,
  action,
  badge,
}: {
  title: string
  subtitle?: React.ReactNode
  action?: React.ReactNode
  badge?: React.ReactNode
}) {
  return (
    <div className="flex min-h-10 items-start justify-between gap-3 px-3.5 pt-3">
      <div className="min-w-0">
        <h2 className="flex items-center gap-1.5 text-[13px] font-semibold leading-5 text-[#111827]">
          {title}
          <span className="flex size-3.5 items-center justify-center rounded-full border border-[#d1d5db] text-[9px] font-medium text-[#9ca3af]">
            i
          </span>
          {badge}
        </h2>
        {subtitle && <div className="mt-0.5 text-[12px] text-[#6b7280]">{subtitle}</div>}
      </div>
      {action}
    </div>
  )
}

function SmallLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 whitespace-nowrap text-[12px] font-medium text-[#2563eb] hover:text-blue-700">
      {children}
      <ArrowRight className="size-3.5" />
    </Link>
  )
}

function EndValueLabel({
  x,
  y,
  value,
  index,
  lastIndex,
  fill,
  textFill = "#fff",
}: {
  x?: number | string
  y?: number | string
  value?: number | string
  index?: number
  lastIndex: number
  fill: string
  textFill?: string
}) {
  if (index !== lastIndex || x == null || y == null || value == null) return null
  const numeric = typeof value === "number" ? value : Number(value)
  const label = `$${numeric.toFixed(2)}M`
  const width = 62
  const height = 20
  const px = Number(x)
  const py = Number(y)
  return (
    <g transform={`translate(${px + 8}, ${py - height / 2})`}>
      <rect width={width} height={height} rx={4} fill={fill} />
      <text x={width / 2} y={height / 2 + 3.5} textAnchor="middle" fill={textFill} fontSize={9} fontWeight={700}>
        {label}
      </text>
    </g>
  )
}

export function LpPortalDashboardScreen() {
  const { selectedFund, asOfDate, funds, presentationCurrency } = useLpPortal()
  const { fundId } = useLpFundScope()
  const { data, loading, error, reload } = useLpDashboardBundle()
  const [period, setPeriod] = React.useState<ChartPeriod>("SI")
  const [documents, setDocuments] = React.useState<ReturnType<typeof mapDocumentRow>[]>([])
  const [documentsLoading, setDocumentsLoading] = React.useState(true)
  const [downloadingDocId, setDownloadingDocId] = React.useState<string | null>(null)

  const fundNameById = React.useMemo(
    () => new Map(funds.map((fund) => [fund.id, fund.name])),
    [funds],
  )

  const historyData = React.useMemo(
    () => (data?.history ?? []).map((point) => {
      const mapped = mapHistoryChartPoint(point)
      return { date: mapped.label, nav: mapped.nav, paidIn: mapped.paidIn }
    }),
    [data?.history],
  )

  const visibleChartData = React.useMemo(() => {
    if (period === "YTD") return historyData.slice(-3)
    if (period === "1Y") return historyData.slice(-6)
    if (period === "3Y") return historyData.slice(-13)
    return historyData
  }, [historyData, period])

  const historyTicks = React.useMemo(
    () => historyData.filter((_, index) => index % Math.max(1, Math.floor(historyData.length / 10)) === 0).map((p) => p.date),
    [historyData],
  )

  const chartYMax = React.useMemo(
    () => niceAxisMax(Math.max(...visibleChartData.flatMap((p) => [p.nav, p.paidIn]), 1)),
    [visibleChartData],
  )

  const lastIndex = Math.max(visibleChartData.length - 1, 0)

  const kpiCards = React.useMemo(() => {
    const kpis = data?.dashboard.kpis
    if (!kpis) return []
    return [
      {
        label: "Total Commitment",
        value: formatMoneyCompact(kpis.totalCommitment, presentationCurrency),
        helper: `${kpis.investmentCount} ${kpis.investmentCount === 1 ? "Commitment" : "Commitments"}`,
        href: "/lp-portal/investments",
        icon: Gauge,
        iconBg: "bg-[#eaf2ff]",
        iconColor: "text-[#2563eb]",
      },
      {
        label: "Paid-In Capital",
        value: formatMoneyCompact(kpis.paidIn, presentationCurrency),
        helper: pctOf(kpis.paidIn, kpis.totalCommitment),
        icon: Crosshair,
        iconBg: "bg-[#eaf2ff]",
        iconColor: "text-[#2563eb]",
      },
      {
        label: "Unfunded Commitment",
        value: formatMoneyCompact(kpis.unfunded, presentationCurrency),
        helper: pctOf(kpis.unfunded, kpis.totalCommitment),
        icon: FilePlus2,
        iconBg: "bg-[#eaf2ff]",
        iconColor: "text-[#2563eb]",
      },
      {
        label: "Current NAV",
        value: formatMoneyCompact(kpis.currentNav, presentationCurrency),
        // SRD section 34's dashboard wireframe carries a ratio row of Net IRR / TVPI / DPI / RVPI.
        // TVPI and DPI sit on this card and the Distributions card respectively, but RVPI had no
        // home on the dashboard at all - it appeared only on the Performance screen. It belongs
        // next to NAV, being residual NAV over paid-in.
        helper: `${formatMultiple(kpis.tvpi)} TVPI · ${formatMultiple(kpis.rvpi)} RVPI`,
        icon: CircleDollarSign,
        iconBg: "bg-[#f3e8ff]",
        iconColor: "text-[#7c3aed]",
      },
      {
        label: "Distributions",
        value: formatMoneyCompact(kpis.distributions, presentationCurrency),
        helper: `${formatMultiple(kpis.dpi)} DPI`,
        icon: TrendingUp,
        iconBg: "bg-[#fff1e8]",
        iconColor: "text-[#f97316]",
      },
      {
        label: "Net IRR",
        value: formatPercent(kpis.netIrr),
        helper: "Since Inception",
        icon: DollarSign,
        iconBg: "bg-[#e6fbf7]",
        iconColor: "text-[#0d9488]",
      },
    ]
  }, [data?.dashboard.kpis, presentationCurrency])

  const capitalPosition = React.useMemo(() => {
    const kpis = data?.dashboard.kpis
    if (!kpis) return []
    const paidIn = parseDecimal(kpis.paidIn) / 1_000_000
    const outstanding = parseDecimal(kpis.outstandingCalled ?? "0") / 1_000_000
    const unfunded = parseDecimal(kpis.unfunded) / 1_000_000
    const distributed = parseDecimal(kpis.distributions) / 1_000_000
    const remaining = Math.max(parseDecimal(kpis.currentNav) / 1_000_000 - distributed, 0)
    const commitment = parseDecimal(kpis.totalCommitment)
    // Takes the RAW amount, in the same units as `commitment` (which is not scaled down).
    // The `* 1_000_000` that used to be here was applied on top of call sites that already
    // pass `xxx * 1_000_000` to undo their own conversion to millions, so every share was
    // multiplied by a million twice over — the Capital Position legend read "$1.25M
    // (5000000.0%)" where it should read 5.0%.
    const pct = (rawValue: number) =>
      commitment > 0 ? `${((rawValue / commitment) * 100).toFixed(1)}%` : "—"
    return [
      {
        name: "Paid-In Capital",
        value: paidIn,
        display: formatMoneyCompact(kpis.paidIn, presentationCurrency),
        percent: pct(paidIn * 1_000_000),
        color: "#1a56db",
      },
      // Unfunded is commitment minus CALLED, so without this slice the panel showed 5.0% and
      // 92.5% and silently lost the 2.5% the investor has been called for and still owes.
      ...(outstanding > 0
        ? [
            {
              name: "Called, Not Yet Paid",
              value: outstanding,
              display: formatMoneyCompact(kpis.outstandingCalled ?? "0", presentationCurrency),
              percent: pct(outstanding * 1_000_000),
              color: "#f59e0b",
            },
          ]
        : []),
      {
        name: "Unfunded Commitment",
        value: unfunded,
        display: formatMoneyCompact(kpis.unfunded, presentationCurrency),
        percent: pct(unfunded * 1_000_000),
        color: "#2dd4bf",
      },
      {
        name: "Distributed",
        value: distributed,
        display: formatMoneyCompact(kpis.distributions, presentationCurrency),
        percent: pct(distributed * 1_000_000),
        color: "#bfdbfe",
      },
      {
        name: "Remaining Value",
        value: remaining,
        display: formatMoneyCompact(remaining * 1_000_000, presentationCurrency),
        percent: pct(remaining * 1_000_000),
        color: "#9ca3af",
      },
    ]
  }, [data?.dashboard.kpis, presentationCurrency])

  const recentActivity = React.useMemo(
    () =>
      (data?.activity ?? []).map((item) => {
        const row = mapRecentActivityRow(item)
        const upper = item.type.toUpperCase()
        return {
          id: item.id,
          type: item.type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          fund: fundNameById.get(item.fundId) ?? item.fundId,
          amount: formatMoney(row.amount, presentationCurrency),
          date: row.at,
          direction: upper.includes("DISTRIBUTION") ? ("up" as const) : ("down" as const),
        }
      }),
    [data?.activity, fundNameById, presentationCurrency],
  )

  const actions = React.useMemo(
    () =>
      (data?.actions ?? []).map((action) => {
        const mapped = mapDashboardAction(action, funds)
        return {
          ...mapped,
          label: mapped.label || actionDisplayLabel(action),
          icon: actionIcon(action.type),
          tone: actionTone(action.severity),
        }
      }),
    [data?.actions, funds],
  )

  const openEnded = data?.dashboard.openEndedSummary

  const openEndedChartData = React.useMemo(
    () => (data?.openEndedHistory ?? []).map((point) => mapOpenEndedHistoryPoint(point)),
    [data?.openEndedHistory],
  )

  const formattedDate = React.useMemo(
    () => new Date(`${asOfDate}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    [asOfDate],
  )

  const valuationStatus = data?.dashboard.valuationStatus ?? "FINAL"

  React.useEffect(() => {
    let cancelled = false
    setDocumentsLoading(true)
    void lpPortalApi
      .getDocuments({ fundId, pageSize: 3 })
      .then((res) => {
        if (!cancelled) setDocuments(res.data.items.map(mapDocumentRow))
      })
      .catch(() => {
        if (!cancelled) setDocuments([])
      })
      .finally(() => {
        if (!cancelled) setDocumentsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [fundId])

  const handleDownloadDocument = async (docId: string, fileName: string) => {
    setDownloadingDocId(docId)
    try {
      const blob = await lpPortalApi.downloadDocument(docId)
      downloadBlob(blob, fileName)
    } finally {
      setDownloadingDocId(null)
    }
  }

  React.useEffect(() => {
    const hash = typeof window !== "undefined" ? window.location.hash.replace("#", "") : ""
    if (!hash) return
    const el = window.document.getElementById(hash)
    if (el) {
      requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "start" }))
    }
  }, [])

  if (loading && !data) {
    return (
      <div className="space-y-5 pb-8">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[118px] rounded-xl" />
          ))}
        </div>
        <div className="grid gap-2.5 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
          <Skeleton className="h-[318px] rounded-xl" />
          <Skeleton className="h-[318px] rounded-xl" />
        </div>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="space-y-4 pb-8">
        <h1 className="text-[24px] font-bold tracking-tight text-[#0f172a]">Dashboard</h1>
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-center">
          <p className="text-sm text-red-700">{error}</p>
          <Button type="button" variant="outline" className="mt-4 rounded-full" onClick={() => void reload()}>
            Try Again
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5 pb-8">
      <div>
        <h1 className="text-[24px] font-bold tracking-tight text-[#0f172a]">
          {selectedFund ? selectedFund.shortName : "Dashboard"}
        </h1>
        <p className="mt-1.5 text-[13px] leading-5 text-[#6b7280]">
          {selectedFund
            ? `Overview of your investment in ${selectedFund.name}`
            : "Overview of your investments and accounts"}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpiCards.map((kpi) => {
          const Icon = kpi.icon
          const helperClassName = "mt-3 text-[12px] font-medium leading-4 text-[#2563eb]"
          const helper = "href" in kpi && kpi.href ? (
            <Link href={kpi.href} className={cn(helperClassName, "hover:text-blue-700")}>
              {kpi.helper}
            </Link>
          ) : (
            <p className={helperClassName}>{kpi.helper}</p>
          )

          return (
            <Panel key={kpi.label} className="min-h-[118px] px-4 py-3.5">
              {/*
                The label used to sit on one line beside the icon, sharing the
                row with the info button, which left it 84px in a card a sixth
                of the row wide. Four of the six labels were cut at every
                viewport tested -- 375, 768 and 1440 -- so an LP saw $25.00M and
                $23.50M side by side under "Total Com..." and "Unfunded ...".
                Wrapping alone was not enough: "Commitment" on its own needs
                90px. The icon and the info button now share the top row and the
                label takes the card's full width beneath them.
              */}
              <div className="flex items-start justify-between gap-2">
                <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", kpi.iconBg, kpi.iconColor)}>
                  <Icon className="size-[18px]" strokeWidth={2} />
                </span>
                <button
                  type="button"
                  className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full text-[#94a3b8] transition-colors hover:bg-slate-100 hover:text-slate-600"
                  aria-label={`${kpi.label} information`}
                  title={kpi.label}
                >
                  <Info className="size-3.5" strokeWidth={2} />
                </button>
              </div>
              <span className="mt-2 block text-[13px] font-medium leading-4 text-[#475569]">{kpi.label}</span>
              <p className="mt-3 text-[24px] font-bold leading-7 tracking-[-0.03em] text-[#0f172a]">{kpi.value}</p>
              {helper}
            </Panel>
          )
        })}
      </div>

      <div className="grid gap-2.5 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <Panel className="overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4">
            <div className="min-w-0">
              <h2 className="flex items-center gap-1.5 text-[14px] font-semibold leading-5 text-[#0f172a]">
                Investment Value History
                <button
                  type="button"
                  className="flex size-4 items-center justify-center rounded-full text-[#94a3b8] hover:bg-slate-100 hover:text-slate-600"
                  aria-label="Investment value history information"
                  title="Investment Value History"
                >
                  <Info className="size-3.5" strokeWidth={2} />
                </button>
              </h2>
              <p className="mt-1 text-[11px] leading-4 text-[#64748b]">
                Since Inception <span className="mx-1 text-[#cbd5e1]">•</span> As of {formattedDate}{" "}
                <span className="mx-1 text-[#cbd5e1]">•</span> Valuation:{" "}
                <span className="font-semibold text-[#334155]">{valuationStatus}</span>
              </p>
            </div>
            <div className="flex items-center gap-1 rounded-full border border-[#e2e8f0] bg-white p-0.5">
              {periods.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setPeriod(item.id)}
                  className={cn(
                    "h-7 rounded-full px-3 text-[11px] font-medium transition-colors",
                    period === item.id
                      ? "border border-[#93c5fd] bg-[#eff6ff] text-[#2563eb]"
                      : "border border-transparent text-[#64748b] hover:bg-slate-50",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 flex items-center gap-5 px-4 text-[11px] text-[#64748b]">
            <span className="flex items-center gap-2">
              <i className="h-[2px] w-4 rounded-full bg-[#1d4ed8]" />
              NAV
            </span>
            <span className="flex items-center gap-2">
              <i className="w-4 border-t-2 border-dashed border-[#38bdf8]" />
              Paid-In Capital
            </span>
          </div>

          <div className="mt-1 h-[250px] w-full px-1 pb-1">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={visibleChartData} margin={{ top: 12, right: 74, left: 2, bottom: 4 }}>
                <defs>
                  <linearGradient id="historyFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563eb" stopOpacity={0.14} />
                    <stop offset="55%" stopColor="#2563eb" stopOpacity={0.04} />
                    <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#eef2f7" strokeDasharray="0" />
                <XAxis
                  dataKey="date"
                  ticks={historyTicks.filter((tick) => visibleChartData.some((point) => point.date === tick))}
                  tick={{ fontSize: 10, fill: "#94a3b8" }}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                />
                <YAxis
                  domain={[0, chartYMax]}
                  ticks={Array.from({ length: 6 }, (_, i) => (chartYMax / 5) * i)}
                  tickFormatter={(value) => (value === 0 ? "$0" : `$${Number(value.toPrecision(3))}M`)}
                  tick={{ fontSize: 10, fill: "#94a3b8" }}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                />
                <Tooltip
                  formatter={(value: number, name: string) => [
                    `$${Number(value).toFixed(2)}M`,
                    name === "nav" ? "NAV" : "Paid-In Capital",
                  ]}
                  labelStyle={{ color: "#64748b", fontSize: 11 }}
                  contentStyle={{
                    borderRadius: 8,
                    borderColor: "#e2e8f0",
                    fontSize: 11,
                    boxShadow: "0 4px 12px rgba(15,23,42,0.08)",
                  }}
                />
                <Area type="monotone" dataKey="nav" fill="url(#historyFill)" stroke="none" isAnimationActive={false} />
                <Line
                  type="monotone"
                  dataKey="nav"
                  name="nav"
                  stroke="#1d4ed8"
                  strokeWidth={2.25}
                  dot={false}
                  activeDot={{ r: 4, fill: "#1d4ed8", stroke: "#fff", strokeWidth: 2 }}
                >
                  <LabelList
                    dataKey="nav"
                    content={(props) => (
                      <EndValueLabel {...props} lastIndex={lastIndex} fill="#1d4ed8" />
                    )}
                  />
                </Line>
                <Line
                  type="monotone"
                  dataKey="paidIn"
                  name="paidIn"
                  stroke="#38bdf8"
                  strokeWidth={1.75}
                  strokeDasharray="5 4"
                  dot={false}
                  activeDot={{ r: 3.5, fill: "#38bdf8", stroke: "#fff", strokeWidth: 2 }}
                >
                  <LabelList
                    dataKey="paidIn"
                    content={(props) => (
                      <EndValueLabel {...props} lastIndex={lastIndex} fill="#7dd3fc" textFill="#0c4a6e" />
                    )}
                  />
                </Line>
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="px-4 pb-4 pt-1">
            <SmallLink href="/lp-portal/performance">View Performance</SmallLink>
          </div>
        </Panel>

        {openEnded ? (
          <Panel id="open-ended-account" className="min-h-[318px]">
            <PanelHeader
              title="Open-Ended / Hedge Fund Account"
              action={<span className="pt-0.5 text-[12px] text-[#6b7280]">As of {formattedDate}</span>}
            />
            <div className="mx-3.5 mt-1 grid grid-cols-3 divide-x divide-slate-200 border-b border-slate-100 pb-3">
              <div className="pr-3">
                <p className="text-[8px] font-medium text-slate-600">Account Value</p>
                <p className="mt-1.5 text-[17px] font-semibold tracking-[-0.02em] text-slate-900">
                  {formatMoneyCompact(openEnded.accountValue, presentationCurrency)}
                </p>
              </div>
              <div className="px-3">
                <p className="text-[8px] font-medium text-slate-600">Units Held</p>
                <p className="mt-1.5 text-[15px] font-semibold tracking-[-0.02em] text-slate-900">
                  {formatUnits(openEnded.unitsHeld, 2)}
                </p>
              </div>
              <div className="pl-3">
                <p className="text-[8px] font-medium text-slate-600">NAV Per Unit</p>
                <p className="mt-1.5 text-[15px] font-semibold tracking-[-0.02em] text-slate-900">
                  {formatMoney(openEnded.navPerUnit, presentationCurrency)}
                </p>
              </div>
            </div>
            {openEndedChartData.length > 0 ? (
              <div className="h-[168px] w-full px-1 pb-1 pt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={openEndedChartData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid vertical={false} stroke="#eef2f7" strokeDasharray="0" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 9, fill: "#94a3b8" }}
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fontSize: 9, fill: "#94a3b8" }}
                      tickLine={false}
                      axisLine={false}
                      width={40}
                      tickFormatter={(v) => `$${Number(v).toFixed(2)}`}
                    />
                    <Tooltip
                      formatter={(value: number) => [formatMoney(value, presentationCurrency), "NAV Per Unit"]}
                      contentStyle={{ borderRadius: 8, borderColor: "#e2e8f0", fontSize: 11 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="navPerUnit"
                      fill="#dbeafe"
                      stroke="none"
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="navPerUnit"
                      stroke="#2563eb"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex h-[168px] items-center justify-center px-3.5 text-[12px] text-[#94a3b8]">
                YTD Return: {formatPercent(openEnded.ytdReturn)}
              </div>
            )}
            <p className="px-3.5 pb-1 text-[10px] text-[#94a3b8]">
              YTD Return: {formatPercent(openEnded.ytdReturn)}
            </p>
            <div className="px-3.5 pb-3">
              <SmallLink href="/lp-portal/account-activity?structure=open-ended">View Account Details</SmallLink>
            </div>
          </Panel>
        ) : null}
      </div>

      <div className="grid gap-2.5 xl:grid-cols-3">
        <Panel id="capital-position">
          <div className="px-4 pt-3.5">
            <h2 className="flex items-center gap-1.5 text-[14px] font-semibold leading-5 text-[#0f172a]">
              Capital Position
              <button
                type="button"
                className="flex size-4 items-center justify-center rounded-full text-[#94a3b8] hover:bg-slate-100 hover:text-slate-600"
                aria-label="Capital position information"
                title="Capital Position"
              >
                <Info className="size-3.5" strokeWidth={2} />
              </button>
            </h2>
            <p className="mt-0.5 text-[11px] leading-4 text-[#64748b]">As of {formattedDate}</p>
          </div>

          <div className="flex items-center gap-3 px-3 pb-2 pt-3">
            <div className="relative h-[148px] w-[148px] shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={capitalPosition}
                    dataKey="value"
                    innerRadius={48}
                    outerRadius={68}
                    paddingAngle={1.5}
                    stroke="#fff"
                    strokeWidth={2}
                    startAngle={90}
                    endAngle={-270}
                  >
                    {capitalPosition.map((item) => (
                      <Cell key={item.name} fill={item.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number, _name, item) => [
                      `$${Number(value).toFixed(2)}M`,
                      (item?.payload as (typeof capitalPosition)[number])?.name ?? "Value",
                    ]}
                    contentStyle={{ borderRadius: 8, borderColor: "#e2e8f0", fontSize: 11 }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-[10px] leading-3 text-[#64748b]">Total Commitment</span>
                <span className="mt-1 text-[16px] font-bold leading-5 tracking-[-0.02em] text-[#0f172a]">
                  {formatMoneyCompact(data?.dashboard.kpis.totalCommitment, presentationCurrency)}
                </span>
              </div>
            </div>

            <div className="min-w-0 flex-1 space-y-3">
              {capitalPosition.map((item) => (
                <button
                  key={item.name}
                  type="button"
                  className="flex w-full items-start gap-2 rounded-md text-left transition-colors hover:bg-slate-50"
                  title={`${item.name}: ${item.display}`}
                >
                  <i className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] leading-4 text-[#334155]">{item.name}</span>
                    <span className="mt-0.5 block text-[12px] font-semibold leading-4 text-[#0f172a]">
                      {item.display}{" "}
                      <span className="font-normal text-[#94a3b8]">({item.percent})</span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="px-4 pb-3.5 pt-1">
            <SmallLink href="/lp-portal/capital-activity">View Capital Summary</SmallLink>
          </div>
        </Panel>

        <Panel className="min-h-[288px]">
          <PanelHeader
            title="Recent Capital Activity"
            action={
              <Link
                href="/lp-portal/account-activity"
                className="text-[12px] font-semibold text-[#2563eb] hover:text-[#1d4ed8]"
              >
                View All
              </Link>
            }
          />
          <div className="mt-1 divide-y divide-[#f3f4f6]">
            {recentActivity.map((activity) => (
              <Link
                key={activity.id}
                href="/lp-portal/capital-activity"
                className="group flex items-center gap-2.5 px-4 py-2.5 hover:bg-[#f9fafb]"
              >
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full",
                    activity.direction === "down" ? "bg-[#dbeafe] text-[#2563eb]" : "bg-[#dcfce7] text-[#16a34a]",
                  )}
                >
                  {activity.direction === "down" ? (
                    <ArrowDownToLine className="size-3.5" />
                  ) : (
                    <ArrowUpRight className="size-3.5" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-semibold text-[#111827]">{activity.type}</span>
                  <span className="block truncate text-[11px] text-[#6b7280]">{activity.fund}</span>
                </span>
                <span className="text-right">
                  <span className="block text-[12px] font-semibold text-[#111827]">{activity.amount}</span>
                  <span className="block text-[11px] text-[#9ca3af]">{activity.date}</span>
                </span>
                <ArrowRight className="size-3.5 shrink-0 text-[#cbd5e1] group-hover:text-[#2563eb]" />
              </Link>
            ))}
          </div>
          <div className="px-4 pb-3.5 pt-2">
            <SmallLink href="/lp-portal/account-activity">View All Activity</SmallLink>
          </div>
        </Panel>

        <div className="grid min-h-[288px] gap-4">
          <Panel>
            <PanelHeader
              title="Actions Required"
              badge={
                <span className="flex size-5 items-center justify-center rounded-full bg-[#ef4444] text-[10px] font-bold text-white">
                  {actions.length}
                </span>
              }
              action={
                <Link
                  href="/lp-portal/requests"
                  className="text-[12px] font-semibold text-[#2563eb] hover:text-[#1d4ed8]"
                >
                  View All
                </Link>
              }
            />
            <div className="divide-y divide-[#f3f4f6]">
              {actions.map((action) => {
                const Icon = action.icon
                return (
                  <Link
                    key={action.title}
                    href={action.href}
                    className="group flex items-center gap-2.5 px-4 py-2.5 hover:bg-[#f9fafb]"
                  >
                    <span
                      className={cn(
                        "flex size-7 shrink-0 items-center justify-center rounded-full",
                        action.tone === "red"
                          ? "bg-red-50 text-red-500"
                          : action.tone === "orange"
                            ? "bg-orange-50 text-orange-500"
                            : "bg-blue-50 text-blue-600",
                      )}
                    >
                      <Icon className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] font-semibold text-[#111827]">{action.title}</span>
                      <span className="block truncate text-[11px] text-[#6b7280]">{action.fund}</span>
                    </span>
                    <span className="text-right">
                      <span className="block text-[12px] font-semibold text-[#111827]">
                        {action.amount ?? action.label}
                      </span>
                      {action.amount ? (
                        <span className="block text-[11px] text-[#6b7280]">{action.label}</span>
                      ) : null}
                      <span className="block text-[11px] font-medium text-[#dc2626]">{action.due}</span>
                    </span>
                    <ArrowRight className="size-3.5 shrink-0 text-[#cbd5e1] group-hover:text-[#2563eb]" />
                  </Link>
                )
              })}
            </div>
          </Panel>

          <Panel id="notices">
            <PanelHeader
              title="Latest Documents & Notices"
              action={
                <Link
                  href="/lp-portal/notices"
                  className="text-[12px] font-semibold text-[#2563eb] hover:text-[#1d4ed8]"
                >
                  View All
                </Link>
              }
            />
            <div className="divide-y divide-[#f3f4f6]">
              {documentsLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="px-4 py-2.5">
                    <Skeleton className="h-10 w-full" />
                  </div>
                ))
              ) : documents.length === 0 ? (
                <p className="px-4 py-6 text-center text-[12px] text-[#9ca3af]">No recent documents</p>
              ) : (
                documents.map((doc) => (
                  <div key={doc.id} className="flex items-center gap-2.5 px-4 py-2.5">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#dbeafe] text-[#2563eb]">
                      <FileText className="size-3.5" />
                    </span>
                    <Link
                      href={doc.category === "Notices" ? "/lp-portal/notices" : "/lp-portal/documents"}
                      className="min-w-0 flex-1 hover:text-[#2563eb]"
                    >
                      <span className="block truncate text-[12px] font-semibold text-[#111827]">{doc.title}</span>
                      <span className="block text-[11px] text-[#9ca3af]">
                        {doc.publishedDate} <span className="mx-1">·</span> {doc.category}
                      </span>
                    </Link>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={downloadingDocId === doc.id}
                      onClick={() => void handleDownloadDocument(doc.id, doc.fileName)}
                      className="size-8 shrink-0 rounded-full text-[#2563eb] hover:bg-[#eff6ff]"
                      aria-label={`Download ${doc.title}`}
                    >
                      <Download className="size-3.5" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}
