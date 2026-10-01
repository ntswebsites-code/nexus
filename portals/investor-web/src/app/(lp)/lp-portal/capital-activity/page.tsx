import { DemoDataRibbon } from "@/components/lp-portal/demo-data-ribbon"
import { LpCapitalActivityScreen } from "@/components/lp-portal/screens/lp-capital-activity-screen"

export default async function CapitalActivityPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string; call?: string }>
}) {
  const params = (await searchParams) ?? {}
  return (
    <>
      <DemoDataRibbon domains={["capital"]} />
      <LpCapitalActivityScreen
        initialTab={params.tab === "distributions" ? "distributions" : "calls"}
        initialCallId={params.call}
      />
    </>
  )
}
