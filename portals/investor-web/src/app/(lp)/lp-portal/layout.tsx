import type { ReactNode } from "react"
import { LpPortalLayout } from "@/components/layout/lp-portal-layout"
import { LpPortalProvider } from "@/components/lp-portal/lp-portal-context"

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <LpPortalProvider>
      <LpPortalLayout>{children}</LpPortalLayout>
    </LpPortalProvider>
  )
}
