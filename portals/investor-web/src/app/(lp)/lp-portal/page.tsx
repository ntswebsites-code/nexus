import { DemoDataRibbon } from "@/components/lp-portal/demo-data-ribbon"
import { LpPortalDashboardScreen } from "@/components/lp-portal/screens/lp-portal-dashboard-screen"

export default function LpPortalPage() {
  return (
    <>
      <DemoDataRibbon domains={["dashboard", "performance"]} />
      <LpPortalDashboardScreen />
    </>
  )
}
