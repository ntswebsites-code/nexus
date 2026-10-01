import { DemoDataRibbon } from "@/components/lp-portal/demo-data-ribbon"
import { LpRequestsMessagesScreen } from "@/components/lp-portal/screens/lp-requests-messages-screen"

export default async function RequestsPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string; ref?: string }>
}) {
  const params = (await searchParams) ?? {}
  return (
    <>
      <DemoDataRibbon domains={["requests"]} />
      <LpRequestsMessagesScreen
        initialTab={params.tab === "messages" ? "messages" : "requests"}
        initialRequestRef={params.ref}
      />
    </>
  )
}
