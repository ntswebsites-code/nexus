"use client"

import { DemoDataRibbon } from "@/components/lp-portal/demo-data-ribbon"
import { LpOrganisationScreen } from "@/components/lp-portal/screens/lp-organisation-screen"

export default function OrganisationPage() {
  return (
    <>
      <DemoDataRibbon domains={["organisation"]} />
      <LpOrganisationScreen />
    </>
  )
}
