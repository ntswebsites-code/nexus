"use client"

/**
 * Runtime LP data-domain flags from `GET /api/v1/platform/flags`.
 *
 * Loaded once per page load and shared by the `lpPortalApi` Proxy (which waits for them before
 * routing a call) and by the "Demo data" ribbon. If the flags cannot be loaded every domain stays
 * on demo data and `status` is "error", which the layout shows as a banner.
 */
import * as React from "react"
import type { PlatformFlags } from "@matanho/shared"
import { apiBaseUrl } from "@/lib/api/api-client"
import { LP_DATA_DOMAINS, allDemoDomains, type LpDataDomain } from "./config"

export interface LpFlagsState {
  status: "loading" | "ready" | "error"
  lp: Record<LpDataDomain, boolean>
  error?: string
}

const FLAGS_TIMEOUT_MS = 8000

let state: LpFlagsState = { status: "loading", lp: allDemoDomains() }
let pending: Promise<LpFlagsState> | null = null
const listeners = new Set<() => void>()

function setState(next: LpFlagsState) {
  state = next
  for (const listener of listeners) listener()
}

async function fetchFlags(): Promise<LpFlagsState> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FLAGS_TIMEOUT_MS)
  try {
    const res = await fetch(`${apiBaseUrl()}/api/v1/platform/flags`, {
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`the server answered ${res.status}`)
    const body = (await res.json()) as Partial<PlatformFlags>
    if (!body?.lp || typeof body.lp !== "object") throw new Error("the response has no LP flags")
    const lp = allDemoDomains()
    for (const domain of LP_DATA_DOMAINS) lp[domain] = body.lp[domain] === true
    return { status: "ready", lp }
  } catch (err) {
    const reason =
      err instanceof DOMException && err.name === "AbortError"
        ? "the request timed out"
        : err instanceof Error
          ? err.message
          : "unknown error"
    return { status: "error", lp: allDemoDomains(), error: reason }
  } finally {
    clearTimeout(timer)
  }
}

/** Cached for the page load; resolves (never rejects) with all-demo flags on failure. */
export function loadLpFlags(): Promise<LpFlagsState> {
  if (typeof window === "undefined") return Promise.resolve(state)
  if (!pending) {
    pending = fetchFlags().then((next) => {
      setState(next)
      return next
    })
  }
  return pending
}

/** Drops the cache and fetches again (the banner's Retry). */
export function reloadLpFlags(): Promise<LpFlagsState> {
  pending = null
  setState({ status: "loading", lp: state.lp })
  return loadLpFlags()
}

/** Current value; false until the flags have loaded. */
export function isLpDomainLive(domain: LpDataDomain): boolean {
  return state.lp[domain] === true
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const serverState: LpFlagsState = { status: "loading", lp: allDemoDomains() }

export function useLpFlags(): LpFlagsState {
  React.useEffect(() => {
    void loadLpFlags()
  }, [])
  return React.useSyncExternalStore(
    subscribe,
    () => state,
    () => serverState,
  )
}
