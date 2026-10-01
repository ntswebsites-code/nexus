/** Formatting helpers for LP Portal API decimal strings */

export function parseDecimal(value: string | number | null | undefined): number {
  if (value == null || value === "") return 0
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

export function formatMoney(
  value: string | number | null | undefined,
  currency = "USD",
  compact = false,
): string {
  const n = parseDecimal(value)
  if (compact) {
    const abs = Math.abs(n)
    if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`
    if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
    if (abs >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

export function formatMoneyCompact(value: string | number | null | undefined, currency = "USD"): string {
  return formatMoney(value, currency, true)
}

export function formatPercent(value: string | number | null | undefined, digits = 1): string {
  const n = parseDecimal(value)
  // API returns rates as decimals (0.1870 = 18.7%)
  const pct = Math.abs(n) <= 1 && !String(value).includes("%") ? n * 100 : n
  return `${pct.toFixed(digits)}%`
}

export function formatMultiple(value: string | number | null | undefined, digits = 2): string {
  const n = parseDecimal(value)
  return `${n.toFixed(digits)}x`
}

export function formatUnits(value: string | number | null | undefined, digits = 2): string {
  return parseDecimal(value).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function formatDate(iso: string | null | undefined, style: "short" | "long" | "datetime" = "short"): string {
  if (!iso) return "—"
  const d = new Date(iso.includes("T") ? iso : `${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  if (style === "datetime") {
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })
  }
  if (style === "long") {
    return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

export function daysUntil(dateIso: string): number {
  const target = new Date(`${dateIso}T00:00:00`)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

export function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

export function formatFileSize(bytes: string | number | null | undefined): string {
  const n = parseDecimal(bytes)
  if (n <= 0) return "—"
  if (n < 1024) return `${Math.round(n)} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.URL.revokeObjectURL(url)
}

/**
 * A "nice" chart axis ceiling for a series whose peak is `maxValue`, in the same units the axis
 * is labelled in.
 *
 * Three charts each rounded up to a fixed multiple of 50 ("$M"), which put every position below
 * 50M on a 0-50M axis: an investor peaking at $1.25M had both series drawn flat along the
 * baseline. The step has to scale with the data instead of being a constant.
 */
export function niceAxisMax(maxValue: number): number {
  const peak = Math.max(Math.abs(maxValue), 1e-9)
  const magnitude = Math.pow(10, Math.floor(Math.log10(peak)))
  const step = [1, 2, 2.5, 5, 10].find((m) => peak <= m * magnitude) ?? 10
  return Number((step * magnitude).toPrecision(3))
}
