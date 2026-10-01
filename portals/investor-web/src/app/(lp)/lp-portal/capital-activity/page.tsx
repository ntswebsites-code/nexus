import { LpCapitalActivityScreen } from "@/components/lp-portal/screens/lp-capital-activity-screen"

export default async function CapitalActivityPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string; call?: string }>
}) {
  const params = (await searchParams) ?? {}
  return (
    <LpCapitalActivityScreen
      initialTab={params.tab === "distributions" ? "distributions" : "calls"}
      initialCallId={params.call}
    />
  )
}
