"use client"

import type React from "react"
import { useEffect } from "react"
import { LpPortalTopbar } from "./lp-portal-topbar"
import { LpPortalSidebar } from "./lp-portal-sidebar"
import { DemoDataRibbon, LpFlagsBanner } from "@/components/lp-portal/demo-data-ribbon"
import { LpIdleTimeout } from "@/components/lp-portal/idle-timeout"
import { LpSessionErrorBanner } from "@/components/lp-portal/lp-session-status"

interface LpPortalLayoutProps {
  children: React.ReactNode
}

export function LpPortalLayout({ children }: LpPortalLayoutProps) {
  useEffect(() => {
    const html = document.documentElement
    const { overflow: prevHtml } = html.style
    const { overflow: prevBody } = document.body.style
    html.style.overflow = "hidden"
    document.body.style.overflow = "hidden"
    return () => {
      html.style.overflow = prevHtml
      document.body.style.overflow = prevBody
    }
  }, [])

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <LpIdleTimeout />
      <div className="hidden h-full shrink-0 lg:flex">
        <LpPortalSidebar />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <LpFlagsBanner />
        <LpPortalTopbar />
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-[#f5f7fb]">
          <div className="mx-auto w-full max-w-[1500px] p-3 lg:p-4">
            <LpSessionErrorBanner />
            <DemoDataRibbon
              domains={["session"]}
              message="The organisation, funds and unread counts in the header and menu are illustrative, not your live account."
            />
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
