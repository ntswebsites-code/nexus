import { DemoDataRibbon } from "@/components/lp-portal/demo-data-ribbon"
import { LpNoticesScreen } from "@/components/lp-portal/screens/lp-notices-screen"

export default async function NoticesPage({
  searchParams,
}: {
  searchParams?: Promise<{ id?: string }>
}) {
  const params = (await searchParams) ?? {}
  return (
    <>
      <DemoDataRibbon domains={["notices"]} />
      <LpNoticesScreen initialNoticeId={params.id} />
    </>
  )
}
