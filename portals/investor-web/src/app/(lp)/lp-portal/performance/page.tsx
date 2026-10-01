"use client"

import { DemoDataRibbon } from "@/components/lp-portal/demo-data-ribbon"
import { LpPerformanceScreen } from "@/components/lp-portal/screens/lp-performance-screen"

export default function PerformancePage() {
  return (
    <>
      <DemoDataRibbon domains={["performance", "reports"]} />
      <LpPerformanceScreen />
    </>
  )
}
