import { DemoDataRibbon } from "@/components/lp-portal/demo-data-ribbon"
import { LpSubscriptionsRedemptionsScreen } from "@/components/lp-portal/screens/lp-subscriptions-redemptions-screen"

export default async function SubscriptionsRedemptionsPage({
  searchParams,
}: {
  searchParams?: Promise<{ type?: string; request?: string }>
}) {
  const params = (await searchParams) ?? {}
  const highlight =
    params.type === "redemptions" ? "redemptions" : params.type === "subscriptions" ? "subscriptions" : undefined

  return (
    <>
      <DemoDataRibbon domains={["dealing"]} />
      <LpSubscriptionsRedemptionsScreen highlight={highlight} initialRequestId={params.request} />
    </>
  )
}
