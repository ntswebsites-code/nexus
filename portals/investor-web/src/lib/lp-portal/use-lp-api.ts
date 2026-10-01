"use client"

import * as React from "react"
import type { LpPortalResponse } from "@/lib/api/lp-portal-api"

export function useLpQuery<T>(
  fetcher: () => Promise<LpPortalResponse<T>>,
  deps: React.DependencyList,
  enabled = true,
) {
  const [data, setData] = React.useState<T | null>(null)
  const [loading, setLoading] = React.useState(enabled)
  const [error, setError] = React.useState<string | null>(null)

  const reload = React.useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    setError(null)
    try {
      const response = await fetcher()
      setData(response.data)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Request failed"
      setError(message)
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [enabled, ...deps])

  React.useEffect(() => {
    void reload()
  }, [reload])

  return { data, loading, error, reload, setData }
}

export function getApiErrorMessage(err: unknown, fallback = "Request failed"): string {
  if (err && typeof err === "object" && "response" in err) {
    const response = (err as { response?: { error?: { message?: string }; message?: string } }).response
    return response?.error?.message ?? response?.message ?? fallback
  }
  if (err instanceof Error) return err.message
  return fallback
}

export function getApiFieldErrors(err: unknown): Record<string, string> | undefined {
  if (err && typeof err === "object" && "response" in err) {
    const response = (err as {
      response?: { error?: { fieldErrors?: Record<string, string> }; fieldErrors?: Record<string, string> }
    }).response
    return response?.error?.fieldErrors ?? response?.fieldErrors
  }
  return undefined
}

export function getApiErrorCode(err: unknown): string | undefined {
  if (err && typeof err === "object" && "response" in err) {
    const response = (err as { response?: { error?: { code?: string }; code?: string } }).response
    return response?.error?.code ?? response?.code
  }
  return undefined
}
