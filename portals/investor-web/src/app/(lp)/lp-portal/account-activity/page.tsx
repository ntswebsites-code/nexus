import { LpAccountActivityScreen } from "@/components/lp-portal/screens/lp-account-activity-screen"

export default async function AccountActivityPage({
  searchParams,
}: {
  searchParams?: Promise<{ structure?: string; entry?: string }>
}) {
  const params = (await searchParams) ?? {}
  return <LpAccountActivityScreen initialStructure={params.structure} initialEntryId={params.entry} />
}
