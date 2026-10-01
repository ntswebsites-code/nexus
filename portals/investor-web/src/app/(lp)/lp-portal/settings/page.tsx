"use client"

import { DemoDataRibbon } from "@/components/lp-portal/demo-data-ribbon"
import { LpSettingsScreen } from "@/components/lp-portal/screens/lp-settings-screen"

export default function SettingsPage() {
  return (
    <>
      <DemoDataRibbon domains={["settings"]} />
      <LpSettingsScreen />
    </>
  )
}
