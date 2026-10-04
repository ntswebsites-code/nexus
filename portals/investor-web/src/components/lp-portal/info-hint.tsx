"use client"

import { Info } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

export function InfoHint({
  label,
  description,
  formula,
  period,
  asOf,
}: {
  label: string
  description?: string
  /** How the figure is calculated (FR-LP-010). */
  formula?: string
  period?: string
  asOf?: string
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="rounded-full text-[#94a3b8] hover:text-[#64748b]"
          aria-label={`${label} info`}
        >
          <Info className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-w-xs rounded-xl text-[12px] leading-5">
        <p className="font-semibold text-[#111827]">{label}</p>
        {description ? <p className="mt-1 text-[#6b7280]">{description}</p> : null}
        {formula ? (
          <p className="mt-1.5 text-[#374151]">
            <span className="font-semibold">Formula: </span>
            {formula}
          </p>
        ) : null}
        {period || asOf ? (
          <p className="mt-1.5 text-[11px] text-[#9ca3af]">
            {period ? `Period: ${period}` : null}
            {period && asOf ? " · " : null}
            {asOf ? `As of ${asOf}` : null}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
