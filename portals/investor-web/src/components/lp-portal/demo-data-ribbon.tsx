"use client"

import { FlaskConical, TriangleAlert } from "lucide-react"
import { LP_DOMAIN_LABELS, type LpDataDomain } from "@/lib/lp-portal/config"
import { reloadLpFlags, useLpFlags } from "@/lib/lp-portal/flags"
import { cn } from "@/lib/utils"

/**
 * "Demo data" ribbon: shown wherever any of `domains` is not live, naming the parts that are
 * demo. Renders nothing once every listed domain is live (or while the flags are still loading,
 * when no data has been fetched yet either).
 */
export function DemoDataRibbon({
  domains,
  message,
  className,
}: {
  domains: LpDataDomain[]
  /** Replaces the default wording when every listed domain is demo. */
  message?: string
  className?: string
}) {
  const flags = useLpFlags()
  if (flags.status === "loading") return null
  const demo = domains.filter((d) => !flags.lp[d])
  if (demo.length === 0) return null
  const partial = demo.length < domains.length

  return (
    <div
      role="note"
      data-testid="demo-data-ribbon"
      data-domains={demo.join(",")}
      className={cn(
        "mb-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-900",
        className,
      )}
    >
      <FlaskConical className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
      <p>
        <span className="mr-1.5 rounded bg-amber-500 px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-white uppercase">
          Demo data
        </span>
        {partial ? (
          <>
            {demo.map((d) => LP_DOMAIN_LABELS[d]).join(", ")} on this page {demo.length === 1 ? "is" : "are"}{" "}
            illustrative and not connected to your live records yet.
          </>
        ) : (
          (message ?? "The figures on this page are illustrative and not connected to your live records yet.")
        )}
      </p>
    </div>
  )
}

/** Banner when the flags could not be loaded: everything falls back to demo data, visibly. */
export function LpFlagsBanner() {
  const flags = useLpFlags()
  if (flags.status !== "error") return null
  return (
    <div
      role="alert"
      data-testid="lp-flags-banner"
      className="flex items-center gap-2 border-b border-rose-200 bg-rose-50 px-4 py-2 text-[13px] text-rose-900"
    >
      <TriangleAlert className="size-4 shrink-0 text-rose-600" aria-hidden />
      <p className="flex-1">
        Live data settings could not be loaded ({flags.error}). Everything in the portal is shown as demo data.
      </p>
      <button
        type="button"
        className="rounded-md border border-rose-300 bg-white px-2.5 py-1 text-xs font-semibold hover:bg-rose-100"
        onClick={() => {
          void reloadLpFlags().then((next) => {
            if (next.status === "ready") window.location.reload()
          })
        }}
      >
        Retry
      </button>
    </div>
  )
}
