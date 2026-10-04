import { cn } from "@/lib/utils"

/** Valuation status dot and label: FINAL green, PROVISIONAL / ESTIMATED amber, RESTATED purple (BR-094, FR-LP-009). */
export const VALUATION_TONE: Record<string, { dot: string; text: string }> = {
  FINAL: { dot: "bg-emerald-500", text: "text-emerald-700" },
  PROVISIONAL: { dot: "bg-amber-500", text: "text-amber-700" },
  ESTIMATED: { dot: "bg-amber-500", text: "text-amber-700" },
  RESTATED: { dot: "bg-purple-500", text: "text-purple-700" },
}

export function ValuationBadge({ status, className }: { status: string; className?: string }) {
  const key = String(status ?? "").toUpperCase()
  const tone = VALUATION_TONE[key] ?? VALUATION_TONE.FINAL
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-bold", tone.text, className)} data-valuation-status={key}>
      <i className={cn("size-1.5 shrink-0 rounded-full", tone.dot)} />
      {key}
    </span>
  )
}
