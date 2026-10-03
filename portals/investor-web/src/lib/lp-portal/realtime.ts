"use client"

/**
 * Realtime updates (GAP-017). Primary transport is server-sent events (`GET /lp-portal/realtime/stream`, session
 * cookie, heartbeat, server-side reconnect hint); while the stream is open the poller is paused. If the stream cannot
 * connect or drops, polling below takes over until it reconnects.
 *
 * Fallback polling: The API has no push transport, so `GET /lp-portal/realtime?since=<cursor>`
 * returns change events derived from this investor's notifications. One poller runs while at least one screen is
 * subscribed and the tab is visible; when the domain is not live (demo data) the API answers `enabled: false` and
 * the poller stays idle. The exported function names are unchanged so the screens keep working.
 */
import { lpPortalApi } from "@/lib/api/lp-portal-api"
import { apiBaseUrl } from "@/lib/api/api-client"

export type LpRealtimeEvent =
  | "lp_notice_updated"
  | "lp_request_created"
  | "lp_request_updated"
  | "lp_request_message"
  | "lp_thread_message"
  | "lp_thread_read"
  | "lp_thread_updated"
  | "lp_notification"
  | "lp_capital_updated"
  | "lp_document_published"
  | "lp_dealing_updated"
  | "lp_counts"

type Handler = (payload: unknown) => void

const handlers = new Map<LpRealtimeEvent, Set<Handler>>()
const seen = new Set<string>()
let cursor: string | undefined
let timer: ReturnType<typeof setTimeout> | null = null
let running = false
let interval = 15_000
let source: EventSource | null = null
let streamOpen = false
const STREAM_EVENTS: LpRealtimeEvent[] = [
  "lp_notification",
  "lp_notice_updated",
  "lp_request_created",
  "lp_request_updated",
  "lp_request_message",
  "lp_thread_message",
  "lp_capital_updated",
  "lp_document_published",
  "lp_dealing_updated",
  "lp_counts",
]

/** True while the push stream is connected; screens may skip their own refresh timers. */
export function isLpRealtimeConnected(): boolean {
  return streamOpen
}

function openStream(): void {
  if (source || typeof window === "undefined" || typeof EventSource === "undefined") return
  const es = new EventSource(`${apiBaseUrl()}/api/v1/lp-portal/realtime/stream`, { withCredentials: true })
  source = es
  es.onopen = () => {
    streamOpen = true
    if (timer) clearTimeout(timer)
    timer = null
  }
  for (const name of STREAM_EVENTS) {
    es.addEventListener(name, (e) => {
      const msg = e as MessageEvent<string>
      if (msg.lastEventId) {
        const key = msg.lastEventId.split("@")[0]!
        if (seen.has(key)) return
        seen.add(key)
        if (seen.size > 500) seen.delete(seen.values().next().value as string)
      }
      let payload: unknown = {}
      try {
        payload = JSON.parse(msg.data)
      } catch {
        /* keep empty payload */
      }
      emit(name, payload)
    })
  }
  es.onerror = () => {
    streamOpen = false
    // CLOSED means the browser gave up (401/403/429): poll instead. Otherwise it reconnects by itself, and
    // polling covers the gap.
    if (es.readyState === EventSource.CLOSED) {
      source = null
    }
    if (running && !timer) schedule()
  }
}

function closeStream(): void {
  source?.close()
  source = null
  streamOpen = false
}

function subscriberCount(): number {
  let n = 0
  handlers.forEach((s) => (n += s.size))
  return n
}

function emit(event: string, payload: unknown): void {
  handlers.get(event as LpRealtimeEvent)?.forEach((h) => {
    try {
      h(payload)
    } catch {
      /* a failing screen handler must not stop the others */
    }
  })
}

async function tick(): Promise<void> {
  timer = null
  if (!running) return
  if (streamOpen) return
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return schedule()
  try {
    const res = await lpPortalApi.getRealtime(cursor)
    const info = res.data
    if (!info?.enabled) {
      // Demo data or polling switched off: stay idle.
      running = false
      closeStream()
      return
    }
    interval = Math.max(5_000, info.pollingIntervalMs ?? interval)
    cursor = info.cursor ?? cursor
    for (const change of info.changes ?? []) {
      if (seen.has(change.id)) continue
      seen.add(change.id)
      if (seen.size > 500) seen.delete(seen.values().next().value as string)
      emit(change.event, change.payload ?? {})
    }
  } catch {
    // Offline or a transient API error: try again at the normal interval.
  }
  schedule()
}

function schedule(): void {
  if (!running || timer) return
  timer = setTimeout(() => void tick(), interval)
}

function start(): void {
  if (running || typeof window === "undefined") return
  running = true
  openStream()
  void tick()
}

function stopIfIdle(): void {
  if (subscriberCount() > 0) return
  running = false
  closeStream()
  if (timer) clearTimeout(timer)
  timer = null
  cursor = undefined
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && running && !timer) void tick()
  })
}

export function joinLpPortalOrg(): void {}
export function joinLpRequestRoom(_reference: string): void {}
export function leaveLpRequestRoom(_reference: string): void {}
export function joinLpThreadRoom(_threadId: string): void {}
export function leaveLpThreadRoom(_threadId: string): void {}

export function subscribeLpRealtime<T = unknown>(event: LpRealtimeEvent, handler: (payload: T) => void): () => void {
  const set = handlers.get(event) ?? new Set<Handler>()
  set.add(handler as Handler)
  handlers.set(event, set)
  start()
  return () => {
    set.delete(handler as Handler)
    stopIfIdle()
  }
}
