"use client"

import * as React from "react"
import Link from "next/link"
import {
  ArrowRight,
  ArrowUp,
  BarChart3,
  Coins,
  Crosshair,
  DollarSign,
  Download,
  FileDown,
  FileText,
  Info,
  Landmark,
  SlidersHorizontal,
} from "lucide-react"
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useLpFundScope, useLpPortal } from "@/components/lp-portal/lp-portal-context"
import { lpPortalApi } from "@/lib/api/lp-portal-api"
import {
  downloadBlob,
  formatDate,
  formatMoneyCompact,
  formatMultiple,
  formatPercent,
  formatUnits,
  niceAxisMax,
  parseDecimal,
} from "@/lib/lp-portal/format"
import { useLpPerformanceBundle } from "@/lib/lp-portal/hooks"
import { InfoHint } from "@/components/lp-portal/info-hint"
import { mapHistoryChartPoint, mapPerformanceStructure } from "@/lib/lp-portal/mappers"
import { cn } from "@/lib/utils"

type ChartPeriod = "SI" | "1Y" | "3Y" | "5Y" | "10Y" | "MAX"
type BenchmarkMetric = "Net IRR" | "TVPI"

const PERIOD_TO_API: Record<string, string> = {
  si: "SI",
  "5y": "5Y",
  "3y": "3Y",
  "1y": "1Y",
  ytd: "YTD",
}

const BENCHMARK_COLORS = ["#0055d4", "#06b6d4", "#8b5cf6", "#f97316", "#10b981"]

function moneyM(value: number) {
  return `$${value.toFixed(2)}M`
}

function KpiCard({
  icon,
  iconBg,
  iconColor,
  label,
  value,
  helper,
  trend,
}: {
  icon: React.ReactNode
  iconBg: string
  iconColor: string
  label: string
  value: string
  helper: string
  trend?: boolean
}) {
  return (
    <div className="rounded-lg border border-[#e5e7eb] bg-white px-3.5 py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-md",
            iconBg,
            iconColor,
          )}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1">
              <p className="truncate text-[12px] font-semibold text-[#0f172a]">{label}</p>
              <InfoHint label={label} description={helper} />
            </div>
            {trend && (
              <ArrowUp className="mt-0.5 size-3.5 shrink-0 text-[#10b981]" strokeWidth={2.75} />
            )}
          </div>
          <p className="mt-1.5 text-[20px] font-bold leading-6 tracking-[-0.03em] tabular-nums text-[#0f172a]">
            {value}
          </p>
          <p className="mt-1 text-[11px] leading-4 text-[#94a3b8]">{helper}</p>
        </div>
      </div>
    </div>
  )
}

function formatCapitalY(v: number) {
  if (v === 0) return "$0"
  // trim binary-float tails such as 1.2000000000000002 out of the tick labels
  const n = Number(Math.abs(v).toPrecision(3))
  if (v < 0) return `($${n}M)`
  return `$${n}M`
}

function CapitalAxisTick({
  x = 0,
  y = 0,
  payload,
}: {
  x?: number
  y?: number
  payload?: { value?: string }
}) {
  const name = payload?.value ?? ""
  const lines =
    name === "Paid-In Capital"
      ? ["Paid-In", "Capital"]
      : name === "Capital Calls"
        ? ["Capital", "Calls"]
        : name === "Current NAV"
          ? ["Current", "NAV"]
          : [name]
  return (
    <text x={x} y={y + 8} textAnchor="middle" fill="#6b7280" fontSize={10}>
      {lines.map((line, i) => (
        <tspan key={`${name}-${line}`} x={x} dy={i === 0 ? 0 : 12}>
          {line}
        </tspan>
      ))}
    </text>
  )
}

function CapitalBarLabel({
  x,
  y,
  width,
  height,
  value,
}: {
  x?: number | string
  y?: number | string
  width?: number | string
  height?: number | string
  value?: number | string
}) {
  if (x == null || y == null || width == null || value == null) return null
  const numeric = typeof value === "number" ? value : Number(value)
  const px = Number(x)
  const py = Number(y)
  const pw = Number(width)
  const ph = Math.abs(Number(height ?? 0))
  const label = numeric < 0 ? `($${Math.abs(numeric).toFixed(2)}M)` : `$${numeric.toFixed(2)}M`
  const labelY = numeric < 0 ? py + ph + 14 : py - 8
  return (
    <text
      x={px + pw / 2}
      y={labelY}
      textAnchor="middle"
      fill="#111827"
      fontSize={11}
      fontWeight={700}
    >
      {label}
    </text>
  )
}

function EndLabel({
  x,
  y,
  value,
  index,
  lastIndex,
  fill,
  textFill = "#ffffff",
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
  const width = 58
  const height = 18
  return (
    <g transform={`translate(${Number(x) + 8}, ${Number(y) - height / 2})`}>
      <rect width={width} height={height} rx={4} fill={fill} />
      <text
        x={width / 2}
        y={height / 2 + 3.5}
        textAnchor="middle"
        fill={textFill}
        fontSize={9}
        fontWeight={700}
      >
        {moneyM(numeric)}
      </text>
    </g>
  )
}

function SectionLink({
  href,
  children,
  className,
}: {
  href: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-1 text-[12px] font-medium text-[#2563eb] hover:text-[#1d4ed8]",
        className,
      )}
    >
      {children}
      <ArrowRight className="size-3.5" />
    </Link>
  )
}

export function LpPerformanceScreen() {
  const { funds, selectedFundId, setSelectedFundId, asOfDate, presentationCurrency } = useLpPortal()
  const { fundId } = useLpFundScope()
  const [period, setPeriod] = React.useState("si")
  const [benchmark, setBenchmark] = React.useState("cambridge")
  const [chartPeriod, setChartPeriod] = React.useState<ChartPeriod>("SI")
  const [benchMetric, setBenchMetric] = React.useState<BenchmarkMetric>("Net IRR")
  const [benchmarkBars, setBenchmarkBars] = React.useState<Array<{ name: string; value: number; fill: string }>>([])
  const [benchmarkLoading, setBenchmarkLoading] = React.useState(false)
  const [reportLoading, setReportLoading] = React.useState(false)

  const apiPeriod = PERIOD_TO_API[period] ?? "SI"
  const { data, loading, error, reload } = useLpPerformanceBundle(apiPeriod, benchmark)

  const performance = data?.performance
  const metrics = performance?.metrics
  const openEndedMetrics = performance?.openEndedMetrics
  const asOfLabel = formatDate(performance?.asOfDate ?? asOfDate, "long")
  const valuationStatus = performance?.valuationStatus ?? "FINAL"
  const reportingCurrency = performance?.reportingCurrency ?? presentationCurrency

  const historyFull = React.useMemo(
    () => (data?.history ?? []).map((point) => mapHistoryChartPoint(point)),
    [data?.history],
  )

  const chartData = React.useMemo(() => {
    if (chartPeriod === "1Y") return historyFull.slice(-4)
    if (chartPeriod === "3Y") return historyFull.slice(-7)
    if (chartPeriod === "5Y") return historyFull.slice(-9)
    return historyFull
  }, [chartPeriod, historyFull])

  const chartYMax = React.useMemo(
    () => niceAxisMax(Math.max(...chartData.flatMap((p) => [p.nav, p.paidIn, p.dist]), 1)),
    [chartData],
  )

  const lastIndex = Math.max(chartData.length - 1, 0)

  const capitalFlow = React.useMemo(() => {
    if (!metrics) return []
    const paidIn = parseDecimal(metrics.paidIn) / 1_000_000
    const distributions = parseDecimal(metrics.distributions) / 1_000_000
    const nav = parseDecimal(metrics.currentNav) / 1_000_000
    return [
      { name: "Paid-In Capital", value: -paidIn, fill: "#0046b5", kind: "paidIn" },
      { name: "Capital Calls", value: -paidIn, fill: "#00aeef", kind: "inflow" },
      { name: "Distributions", value: distributions, fill: "#34a853", kind: "outflow" },
      { name: "Current NAV", value: nav, fill: "#0046b5", kind: "nav" },
    ]
  }, [metrics])

  const capitalYMax = React.useMemo(
    () => niceAxisMax(Math.max(...capitalFlow.map((item) => Math.abs(item.value)), 1)),
    [capitalFlow],
  )

  const benchmarkLatest = React.useMemo(() => {
    const b = data?.benchmarks
    if (!b || b.configured === false || !b.series?.length) return "—"
    const last = b.series[b.series.length - 1]
    const v = parseDecimal(last.value)
    return b.metric === "TVPI" ? formatMultiple(String(v)) : formatPercent(String(v))
  }, [data?.benchmarks])

  const fundRows = React.useMemo(
    () =>
      (data?.byFund ?? []).map((row) => ({
        fundId: row.fundId,
        fund: row.fundName,
        structure: mapPerformanceStructure(row),
        // These come back null for OPEN_ENDED funds, which have no called or paid-in capital to
        // define them against (SRD sections 3 and 37). Passing null through the formatters would
        // print "0.0%" and "0.00x" — a zero is a claim, and an absent measure is not zero.
        netIrr: row.netIrr == null ? "—" : formatPercent(row.netIrr),
        tvpi: row.tvpi == null ? "—" : formatMultiple(row.tvpi),
        nav: formatMoneyCompact(row.nav, reportingCurrency),
        // The Benchmark column used to render `benchmarks.note`, which was the backend's own
        // placeholder sentence ("replace with approved index feed when available") — developer
        // prose shown to investors in a data column. It now shows the benchmark's latest approved
        // value, or an em dash when no approved series is configured.
        benchmark: benchmarkLatest,
        asOf: asOfLabel,
      })),
    [asOfLabel, benchmarkLatest, data?.byFund, reportingCurrency],
  )

  React.useEffect(() => {
    let cancelled = false
    setBenchmarkLoading(true)
    void lpPortalApi
      .getPerformanceBenchmarks({
        fundId,
        metric: benchMetric === "TVPI" ? "TVPI" : "NET_IRR",
        benchmarkId: benchmark,
      })
      .then((res) => {
        if (cancelled) return
        setBenchmarkBars(
          res.data.series.map((item, index) => ({
            name: item.label,
            value:
              benchMetric === "TVPI"
                ? parseDecimal(item.value)
                : parseDecimal(item.value) <= 1
                  ? parseDecimal(item.value) * 100
                  : parseDecimal(item.value),
            fill: BENCHMARK_COLORS[index % BENCHMARK_COLORS.length],
          })),
        )
      })
      .catch(() => {
        if (!cancelled) setBenchmarkBars([])
      })
      .finally(() => {
        if (!cancelled) setBenchmarkLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [benchMetric, benchmark, fundId])

  const downloadReport = async () => {
    setReportLoading(true)
    try {
      const res = await lpPortalApi.downloadPerformanceReport({ fundId })
      let job = await lpPortalApi.getJob(res.data.jobId)
      let attempts = 0
      while (
        !["COMPLETED", "FAILED", "CANCELLED"].includes(job.data.status.toUpperCase()) &&
        attempts < 30
      ) {
        await new Promise((resolve) => window.setTimeout(resolve, 2000))
        job = await lpPortalApi.getJob(res.data.jobId)
        attempts += 1
      }
      if (job.data.status.toUpperCase() === "FAILED") {
        toast.error(job.data.errorMessage ?? "Report generation failed")
        return
      }
      const blob = await lpPortalApi.downloadReport(res.data.jobId)
      downloadBlob(blob, "lp-performance-report.pdf")
      toast.success("Performance report downloaded")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to download performance report")
    } finally {
      setReportLoading(false)
    }
  }

  if (loading && !data) {
    return (
      <div className="space-y-5 pb-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-96" />
        <div className="grid gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 rounded-lg" />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="space-y-5 pb-8">
        <h1 className="text-[24px] font-bold tracking-tight text-[#0f172a]">Performance</h1>
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-center">
          <p className="text-sm text-red-700">{error}</p>
          <Button type="button" variant="outline" className="mt-4 rounded-full" onClick={() => void reload()}>
            Try Again
          </Button>
        </div>
      </div>
    )
  }

  const benchmarkMax = Math.max(...benchmarkBars.map((row) => row.value), benchMetric === "TVPI" ? 2 : 30)

  return (
    <div className="space-y-5 pb-8">
      <div>
        <h1 className="text-[24px] font-bold tracking-tight text-[#0f172a]">Performance</h1>
        <p className="mt-1.5 text-[13px] leading-5 text-[#6b7280]">
          Measure long-term value creation and investor returns across your private markets portfolio.
        </p>
      </div>

      {/* Filters — labels above, valuation status card on the right */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.15fr)_auto] lg:items-end">
        <div>
          <label className="mb-1.5 block text-[12px] font-semibold text-[#374151]">
            Fund / Account
          </label>
          <Select
            value={selectedFundId}
            onValueChange={(value) => setSelectedFundId(value as typeof selectedFundId)}
          >
            <SelectTrigger className="h-10 w-full rounded-lg border-[#e5e7eb] bg-white text-[13px] text-[#0f172a] shadow-none">
              <SelectValue placeholder="All Funds" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Funds</SelectItem>
              {funds.map((fund) => (
                <SelectItem key={fund.id} value={fund.id}>
                  {fund.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1.5 block text-[12px] font-semibold text-[#374151]">Period</label>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="h-10 w-full rounded-lg border-[#e5e7eb] bg-white text-[13px] text-[#0f172a] shadow-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="si">Since Inception</SelectItem>
              <SelectItem value="5y">5 Years</SelectItem>
              <SelectItem value="3y">3 Years</SelectItem>
              <SelectItem value="1y">1 Year</SelectItem>
              <SelectItem value="ytd">Year to Date</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1.5 block text-[12px] font-semibold text-[#374151]">Benchmark</label>
          <Select value={benchmark} onValueChange={setBenchmark}>
            <SelectTrigger className="h-10 w-full rounded-lg border-[#e5e7eb] bg-white text-[13px] text-[#0f172a] shadow-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cambridge">Cambridge Associates U.S. PE Index</SelectItem>
              <SelectItem value="sp500">S&P 500</SelectItem>
              <SelectItem value="russell">Russell 3000</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex h-10 min-w-[148px] flex-col justify-center rounded-lg border border-[#e5e7eb] bg-white px-3.5">
          <span className="text-[9px] font-semibold uppercase tracking-[0.06em] text-[#9ca3af]">
            Valuation Status
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[13px] font-bold text-[#0f172a]">
            <span className="size-2 shrink-0 rounded-full bg-[#10b981]" />
            {valuationStatus}
          </span>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          icon={<DollarSign className="size-4" strokeWidth={2.25} />}
          iconBg="bg-[#dcfce7]"
          iconColor="text-[#16a34a]"
          label="Net IRR"
          value={formatPercent(metrics?.netIrr)}
          helper="Since Inception"
          trend
        />
        <KpiCard
          icon={<BarChart3 className="size-4" strokeWidth={2.25} />}
          iconBg="bg-[#ffedd5]"
          iconColor="text-[#ea580c]"
          label="TVPI"
          value={formatMultiple(metrics?.tvpi)}
          helper="Since Inception"
          trend
        />
        <KpiCard
          icon={<Coins className="size-4" strokeWidth={2.25} />}
          iconBg="bg-[#dbeafe]"
          iconColor="text-[#2563eb]"
          label="DPI"
          value={formatMultiple(metrics?.dpi)}
          helper="Since Inception"
          trend
        />
        <KpiCard
          icon={<SlidersHorizontal className="size-4" strokeWidth={2.25} />}
          iconBg="bg-[#ffedd5]"
          iconColor="text-[#ea580c]"
          label="RVPI"
          value={formatMultiple(metrics?.rvpi)}
          helper="Since Inception"
          trend
        />
        <KpiCard
          icon={<Crosshair className="size-4" strokeWidth={2.25} />}
          iconBg="bg-[#dbeafe]"
          iconColor="text-[#2563eb]"
          label="Current NAV"
          value={formatMoneyCompact(metrics?.currentNav, reportingCurrency)}
          helper={`As of ${asOfLabel}`}
        />
        <KpiCard
          icon={<Landmark className="size-4" strokeWidth={2.25} />}
          iconBg="bg-[#dbeafe]"
          iconColor="text-[#1d4ed8]"
          label="Paid-In Capital"
          value={formatMoneyCompact(metrics?.paidIn, reportingCurrency)}
          helper="Since Inception"
        />
      </div>

      {openEndedMetrics ? (
        <section className="rounded-xl border border-[#e5e7eb] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <h2 className="text-[14px] font-semibold text-[#111827]">Open-Ended Account Metrics</h2>
          <p className="mt-1 text-[11px] text-[#9ca3af]">As of {asOfLabel}</p>
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <div>
              <p className="text-[11px] text-[#6b7280]">Account Value</p>
              <p className="mt-1 text-[18px] font-bold tabular-nums text-[#0f172a]">
                {formatMoneyCompact(openEndedMetrics.accountValue, reportingCurrency)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-[#6b7280]">Units Held</p>
              <p className="mt-1 text-[18px] font-bold tabular-nums text-[#0f172a]">
                {formatUnits(openEndedMetrics.unitsHeld)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-[#6b7280]">NAV Per Unit</p>
              <p className="mt-1 text-[18px] font-bold tabular-nums text-[#0f172a]">
                {formatMoneyCompact(openEndedMetrics.navPerUnit, reportingCurrency)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-[#6b7280]">YTD Return</p>
              <p className="mt-1 text-[18px] font-bold tabular-nums text-[#0f172a]">
                {formatPercent(openEndedMetrics.ytdReturn)}
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {/* Charts row */}
      <div className="grid items-stretch gap-5 xl:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
        <section className="flex flex-col overflow-hidden rounded-xl border border-[#e5e7eb] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex flex-col gap-3 px-5 pt-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-1.5">
                <h2 className="text-[14px] font-semibold text-[#111827]">Performance History</h2>
                <InfoHint label="Performance History" description="Investment value over the selected period." />
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-4 text-[11px] text-[#6b7280]">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-[2px] w-4 rounded-full bg-[#0055d4]" />
                  NAV
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-0 w-4 border-t-2 border-dashed border-[#49b2e1]" />
                  Cumulative Paid-In
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-[2px] w-4 rounded-full bg-[#10b981]" />
                  Distributions
                </span>
              </div>
            </div>
            <div className="flex shrink-0 overflow-hidden rounded-md border border-[#e5e7eb] bg-white">
              {(["SI", "1Y", "3Y", "5Y", "10Y", "MAX"] as ChartPeriod[]).map((p, i) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setChartPeriod(p)}
                  className={cn(
                    "px-2.5 py-1.5 text-[11px] font-semibold transition",
                    i > 0 && "border-l border-[#e5e7eb]",
                    chartPeriod === p
                      ? "bg-[#e8f0fe] text-[#0055d4]"
                      : "bg-white text-[#4b5563] hover:bg-[#f9fafb]",
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-1 h-[300px] min-h-0 flex-1 px-2 pb-1 pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 18, right: 78, left: 4, bottom: 4 }}>
                <defs>
                  <linearGradient id="perfNavFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0055d4" stopOpacity={0.14} />
                    <stop offset="100%" stopColor="#0055d4" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="0" vertical={false} stroke="#f1f5f9" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "#9ca3af" }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  domain={[0, chartYMax]}
                  ticks={Array.from({ length: 6 }, (_, i) => (chartYMax / 5) * i)}
                  tickFormatter={(v) => (v === 0 ? "$0" : `$${Number(v.toPrecision(3))}M`)}
                  tick={{ fontSize: 10, fill: "#9ca3af" }}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                  label={{
                    value: "USD (Millions)",
                    position: "insideTopLeft",
                    offset: 0,
                    dy: -12,
                    style: { fontSize: 10, fill: "#9ca3af" },
                  }}
                />
                <RechartsTooltip
                  formatter={(value: number, name: string) => [moneyM(value), name]}
                  contentStyle={{ borderRadius: 8, borderColor: "#e5e7eb", fontSize: 11 }}
                />
                <Area
                  type="monotone"
                  dataKey="nav"
                  stroke="none"
                  fill="url(#perfNavFill)"
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="nav"
                  name="NAV"
                  stroke="#0055d4"
                  strokeWidth={2.25}
                  dot={false}
                  isAnimationActive={false}
                >
                  <LabelList
                    dataKey="nav"
                    content={(props) => (
                      <EndLabel {...props} lastIndex={lastIndex} fill="#0055d4" />
                    )}
                  />
                </Line>
                <Line
                  type="monotone"
                  dataKey="paidIn"
                  name="Cumulative Paid-In"
                  stroke="#49b2e1"
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  dot={false}
                  isAnimationActive={false}
                >
                  <LabelList
                    dataKey="paidIn"
                    content={(props) => (
                      <EndLabel
                        {...props}
                        lastIndex={lastIndex}
                        fill="#dbeafe"
                        textFill="#1d4ed8"
                      />
                    )}
                  />
                </Line>
                <Line
                  type="monotone"
                  dataKey="dist"
                  name="Distributions"
                  stroke="#10b981"
                  strokeWidth={2.25}
                  dot={false}
                  isAnimationActive={false}
                >
                  <LabelList
                    dataKey="dist"
                    content={(props) => (
                      <EndLabel {...props} lastIndex={lastIndex} fill="#10b981" />
                    )}
                  />
                </Line>
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-auto px-5 pb-4 pt-1">
            <SectionLink href="/lp-portal/account-activity">View Full Performance Details</SectionLink>
          </div>
        </section>

        <section className="flex flex-col overflow-hidden rounded-xl border border-[#e5e7eb] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between gap-2 px-5 pt-5">
            <div className="flex items-center gap-1.5">
              <h2 className="text-[14px] font-semibold text-[#111827]">Benchmark Comparison</h2>
              <InfoHint label="Benchmark Comparison" description="Compare fund performance against selected benchmarks." />
            </div>
            <Select
              value={benchMetric}
              onValueChange={(v) => setBenchMetric(v as BenchmarkMetric)}
            >
              <SelectTrigger className="h-8 w-[104px] rounded-md border-[#e5e7eb] bg-white text-[12px] shadow-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Net IRR">Net IRR</SelectItem>
                <SelectItem value="TVPI">TVPI</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="mt-5 flex min-h-0 flex-1 flex-col px-5">
            <div className="flex flex-1 flex-col justify-center gap-5">
              {benchmarkLoading ? (
                Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)
              ) : benchmarkBars.length === 0 ? (
                <p className="text-center text-[12px] text-[#9ca3af]">
                  {data?.benchmarks?.note ?? "No approved benchmark series is configured."}
                </p>
              ) : (
                benchmarkBars.map((row) => (
                  <div key={row.name} className="grid grid-cols-1 gap-1.5">
                    <div className="flex items-center justify-between gap-3 text-[12px]">
                      <span className="inline-flex min-w-0 items-center gap-2 text-[#374151]">
                        <span
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: row.fill }}
                        />
                        <span className="truncate font-semibold text-[#111827]">{row.name}</span>
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums text-[#111827]">
                        {benchMetric === "TVPI" ? `${row.value.toFixed(2)}x` : `${row.value.toFixed(1)}%`}
                      </span>
                    </div>
                    <div className="relative h-3.5">
                      <div className="absolute inset-0 flex">
                        {[0, 1, 2, 3].map((n) => (
                          <div
                            key={n}
                            className="h-full flex-1 border-l border-[#f3f4f6] first:border-l-0"
                          />
                        ))}
                      </div>
                      <div
                        className="relative h-full rounded-full"
                        style={{
                          width: `${Math.min((row.value / benchmarkMax) * 100, 100)}%`,
                          backgroundColor: row.fill,
                        }}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="mt-4 border-t border-transparent pt-1">
              <div className="flex justify-between px-0.5 text-[10px] text-[#9ca3af]">
                <span>0%</span>
                <span>10%</span>
                <span>20%</span>
                <span>30%</span>
              </div>
              <p className="mt-2 text-center text-[11px] text-[#9ca3af]">Since Inception</p>
            </div>
          </div>

          <div className="mt-auto px-5 pb-4 pt-3">
            <SectionLink href="/lp-portal/performance">View Rolling Returns</SectionLink>
          </div>
        </section>
      </div>

      {/* Capital activity + fund table */}
      <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.65fr)]">
        <section className="flex flex-col overflow-hidden rounded-xl border border-[#e5e7eb] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-start justify-between gap-3 px-5 pt-4">
            <div>
              <div className="flex items-center gap-1.5">
                <h2 className="text-[14px] font-semibold text-[#111827]">
                  Capital Activity (Cash Flow)
                </h2>
                <InfoHint label="Capital Activity" description="Capital calls and distributions over time." />
              </div>
              <p className="mt-1 text-[11px] text-[#9ca3af]">USD (Millions)</p>
            </div>
            <span className="shrink-0 pt-0.5 text-[12px] text-[#9ca3af]">Since Inception</span>
          </div>

          <div className="h-[280px] min-h-0 flex-1 px-1 pb-1 pt-1">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={capitalFlow}
                margin={{ top: 28, right: 12, left: 4, bottom: 8 }}
                barCategoryGap="22%"
              >
                <CartesianGrid strokeDasharray="0" vertical={false} stroke="#e5e7eb" />
                <XAxis
                  dataKey="name"
                  tick={<CapitalAxisTick />}
                  axisLine={false}
                  tickLine={false}
                  interval={0}
                  height={40}
                />
                <YAxis
                  domain={[-capitalYMax, capitalYMax]}
                  ticks={[-capitalYMax, -capitalYMax / 2, 0, capitalYMax / 2, capitalYMax]}
                  tickFormatter={formatCapitalY}
                  tick={{ fontSize: 10, fill: "#9ca3af" }}
                  axisLine={false}
                  tickLine={false}
                  width={56}
                />
                <ReferenceLine y={capitalFlow.find((item) => item.kind === "outflow")?.value ?? 0} stroke="#cbd5e1" strokeDasharray="4 4" />
                <ReferenceLine y={0} stroke="#d1d5db" />
                <RechartsTooltip
                  formatter={(value: number) => formatCapitalY(value)}
                  contentStyle={{ borderRadius: 8, borderColor: "#e5e7eb", fontSize: 11 }}
                />
                <Bar dataKey="value" maxBarSize={52} isAnimationActive={false}>
                  {capitalFlow.map((item) => (
                    <Cell key={item.name} fill={item.fill} />
                  ))}
                  <LabelList dataKey="value" content={<CapitalBarLabel />} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 pb-2 pt-1 text-[11px] text-[#6b7280]">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 shrink-0 rounded-[2px] bg-[#00aeef]" />
              Inflows (Calls)
              <InfoHint label="Inflows (Calls)" description="Capital called from investors." />
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 shrink-0 rounded-[2px] bg-[#34a853]" />
              Outflows (Distributions)
              <InfoHint label="Outflows (Distributions)" description="Cash distributed to investors." />
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 shrink-0 rounded-[2px] bg-[#0046b5]" />
              Ending Value (NAV)
            </span>
          </div>

          <div className="mt-auto px-5 pb-4 pt-2">
            <SectionLink href="/lp-portal/capital-activity">View Cash Flow Details</SectionLink>
          </div>
        </section>

        <section className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-[#e5e7eb] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between gap-2 px-5 pb-3 pt-4">
            <div className="flex items-center gap-1.5">
              <h2 className="text-[14px] font-semibold text-[#111827]">Performance by Fund</h2>
              <InfoHint label="Performance by Fund" description="Fund-level metrics for your entitled investments." />
            </div>
            <SectionLink href="/lp-portal/investments">View All Funds</SectionLink>
          </div>
          <div className="min-w-0 flex-1 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[12px]">
              <thead>
                <tr className="border-b border-[#e5e7eb] text-[11px] font-semibold text-[#111827]">
                  <th className="px-5 py-2.5 font-semibold">Fund</th>
                  <th className="px-3 py-2.5 font-semibold">Structure</th>
                  <th className="px-3 py-2.5 font-semibold">Net IRR</th>
                  <th className="px-3 py-2.5 font-semibold">TVPI / Return</th>
                  <th className="px-3 py-2.5 font-semibold">NAV / Account Value</th>
                  <th className="px-3 py-2.5 font-semibold">Benchmark</th>
                  <th className="px-5 py-2.5 font-semibold">As Of</th>
                </tr>
              </thead>
              <tbody>
                {fundRows.map((row) => (
                  <tr key={row.fundId} className="border-b border-[#f3f4f6] last:border-0">
                    <td className="px-5 py-3">
                      <button
                        type="button"
                        className="text-left font-medium text-[#0056d2] hover:underline"
                        onClick={() => setSelectedFundId(row.fundId)}
                      >
                        {row.fund}
                      </button>
                    </td>
                    <td className="px-3 py-3 text-[#4b5563]">{row.structure}</td>
                    <td className="px-3 py-3 tabular-nums text-[#111827]">{row.netIrr}</td>
                    <td className="px-3 py-3 tabular-nums text-[#111827]">{row.tvpi}</td>
                    <td className="px-3 py-3 font-medium tabular-nums text-[#111827]">{row.nav}</td>
                    <td className="px-3 py-3 text-[#4b5563]">{row.benchmark}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-[#4b5563]">{row.asOf}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-auto px-5 pb-4 pt-3 text-[11px] italic leading-4 text-[#9ca3af]">
            Performance is net of fees, expenses and carried interest, if applicable.
          </div>
        </section>
      </div>

      {/* Footer utility cards */}
      <div className="grid items-stretch gap-4 md:grid-cols-3">
        <section className="flex flex-col rounded-xl border border-[#e5e7eb] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex size-10 items-center justify-center rounded-lg bg-[#e8f1ff] text-[#2563eb]">
            <FileText className="size-[18px]" strokeWidth={1.75} />
          </div>
          <div className="mt-3 flex items-center gap-1.5">
            <h3 className="text-[14px] font-semibold text-[#111827]">Performance Methodology</h3>
            <InfoHint label="Performance Methodology" description="Read the fund's performance calculation methodology." />
          </div>
          <p className="mt-2 text-[12px] leading-5 text-[#6b7280]">
            Performance is calculated in accordance with the Global Investment Performance Standards
            (GIPS®) and based on capital flows and valuations as of the valuation date.
          </p>
          <SectionLink href="/lp-portal/documents?category=Fund%20Reports" className="mt-auto pt-4">
            View Methodology
          </SectionLink>
        </section>

        <section className="flex flex-col rounded-xl border border-[#e5e7eb] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex size-10 items-center justify-center rounded-lg bg-[#e8f1ff] text-[#2563eb]">
            <FileText className="size-[18px]" strokeWidth={1.75} />
          </div>
          <div className="mt-3 flex items-center gap-1.5">
            <h3 className="text-[14px] font-semibold text-[#111827]">Valuation Notes</h3>
            <InfoHint label="Valuation Notes" description="Notes on valuation basis and as-of dates." />
          </div>
          <p className="mt-2 text-[12px] leading-5 text-[#6b7280]">
            All investments are valued in good faith pursuant to the fund&apos;s valuation policy.
            The most recent valuation is as of {asOfLabel}.
          </p>
          <SectionLink href="/lp-portal/documents?category=Fund%20Reports" className="mt-auto pt-4">
            View Valuation Notes
          </SectionLink>
        </section>

        <section className="flex flex-col rounded-xl border border-[#e5e7eb] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex size-10 items-center justify-center rounded-lg bg-[#e8f1ff] text-[#2563eb]">
            <FileDown className="size-[18px]" strokeWidth={1.75} />
          </div>
          <div className="mt-3 flex items-center gap-1.5">
            <h3 className="text-[14px] font-semibold text-[#111827]">Download Performance Report</h3>
            <InfoHint label="Download Performance Report" description="Generate and download a performance report PDF." />
          </div>
          <p className="mt-2 text-[12px] leading-5 text-[#6b7280]">
            Download the comprehensive performance report including detailed returns, cash flows and
            benchmark analysis.
          </p>
          <div className="mt-auto pt-4">
            <Button
              type="button"
              variant="outline"
              disabled={reportLoading}
              className="h-9 rounded-full border-[#d1d5db] bg-white px-4 text-[12px] font-medium text-[#2563eb] shadow-none hover:bg-[#f9fafb] hover:text-[#1d4ed8]"
              onClick={() => void downloadReport()}
            >
              <Download className="size-3.5 text-[#2563eb]" />
              Download Report
            </Button>
          </div>
        </section>
      </div>
    </div>
  )
}
