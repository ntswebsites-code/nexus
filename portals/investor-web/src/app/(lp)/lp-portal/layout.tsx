import type { ReactNode } from "react"
import { LpPortalLayout } from "@/components/layout/lp-portal-layout"
import { LpPortalProvider } from "@/components/lp-portal/lp-portal-context"
import { LpStepUpProvider } from "@/components/lp-portal/step-up-dialog"

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <LpStepUpProvider>
      <LpPortalProvider>
        <LpPortalLayout>{children}</LpPortalLayout>
      </LpPortalProvider>
    </LpStepUpProvider>
  )
}
