"use client"

import * as React from "react"
import { toast } from "sonner"
import { signOut, useSessionUser } from "@matanho/portal-kit/session"

const ACTIVITY_EVENTS = ["mousedown", "keydown", "scroll", "touchstart", "pointermove"] as const
const WARN_BEFORE_MS = 60_000
const CHECK_EVERY_MS = 15_000

function idleMinutes(): number {
  const n = Number(process.env.NEXT_PUBLIC_LP_IDLE_MINUTES)
  return Number.isFinite(n) && n > 0 ? n : 30
}

/**
 * Client side of the session idle timeout (FR-AUTH-012). The API expires an idle session on its
 * own and the next call answers 401, which the API client turns into a redirect to /login; this
 * watcher ends the session at the same point without waiting for a click, with a one-minute
 * warning. Only active when someone is signed in.
 */
export function LpIdleTimeout() {
  const user = useSessionUser()
  const lastActivity = React.useRef(Date.now())
  const warned = React.useRef(false)

  React.useEffect(() => {
    if (!user) return
    const limitMs = idleMinutes() * 60_000
    lastActivity.current = Date.now()

    const onActivity = () => {
      lastActivity.current = Date.now()
      if (warned.current) {
        warned.current = false
        toast.dismiss("lp-idle-warning")
      }
    }
    for (const evt of ACTIVITY_EVENTS) window.addEventListener(evt, onActivity, { passive: true })

    const timer = window.setInterval(() => {
      const idle = Date.now() - lastActivity.current
      if (idle >= limitMs) {
        window.clearInterval(timer)
        toast.dismiss("lp-idle-warning")
        void signOut()
      } else if (idle >= limitMs - WARN_BEFORE_MS && !warned.current) {
        warned.current = true
        toast.warning("You will be signed out in about a minute because of inactivity.", {
          id: "lp-idle-warning",
          duration: WARN_BEFORE_MS,
        })
      }
    }, CHECK_EVERY_MS)

    return () => {
      window.clearInterval(timer)
      for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, onActivity)
    }
  }, [user])

  return null
}
