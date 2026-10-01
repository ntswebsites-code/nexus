"use client"

/**
 * Realtime updates need a live API socket. The LP portal runs on demo data, so every function
 * here is a no-op; the exports are kept so the screens that subscribe keep working unchanged.
 */
export type LpRealtimeEvent =
  | "lp_notice_updated"
  | "lp_request_created"
  | "lp_request_updated"
  | "lp_request_message"
  | "lp_thread_message"
  | "lp_thread_read"
  | "lp_thread_updated"
  | "lp_notification"

export function joinLpPortalOrg(): void {}
export function joinLpRequestRoom(_reference: string): void {}
export function leaveLpRequestRoom(_reference: string): void {}
export function joinLpThreadRoom(_threadId: string): void {}
export function leaveLpThreadRoom(_threadId: string): void {}

export function subscribeLpRealtime<T = unknown>(
  _event: LpRealtimeEvent,
  _handler: (payload: T) => void,
): () => void {
  return () => undefined
}
