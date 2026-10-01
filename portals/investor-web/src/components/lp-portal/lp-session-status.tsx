"use client"

import { TriangleAlert } from "lucide-react"
import { useLpPortal } from "./lp-portal-context"

/**
 * The account session failed to load. With the session domain live this is a real error (it is
 * never replaced by the demo session), so the portal says so and offers a retry.
 */
export function LpSessionErrorBanner() {
  const { sessionError, sessionLoading, refreshSession } = useLpPortal()
  if (!sessionError) return null
  return (
    <div
      role="alert"
      data-testid="lp-session-error"
      className="mb-3 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-900"
    >
      <TriangleAlert className="size-4 shrink-0 text-rose-600" aria-hidden />
      <p className="flex-1">Your account details could not be loaded: {sessionError}</p>
      <button
        type="button"
        disabled={sessionLoading}
        className="rounded-md border border-rose-300 bg-white px-2.5 py-1 text-xs font-semibold hover:bg-rose-100 disabled:opacity-50"
        onClick={() => void refreshSession()}
      >
        Retry
      </button>
    </div>
  )
}
