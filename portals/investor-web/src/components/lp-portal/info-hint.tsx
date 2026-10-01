"use client"

import { Info } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

export function InfoHint({
  label,
  description,
}: {
  label: string
  description?: string
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
      </PopoverContent>
    </Popover>
  )
}
