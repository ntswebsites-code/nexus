import { DemoDataRibbon } from "@/components/lp-portal/demo-data-ribbon"
import { LpDocumentCentreScreen } from "@/components/lp-portal/screens/lp-document-centre-screen"

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams?: Promise<{ category?: string; document?: string }>
}) {
  const params = (await searchParams) ?? {}
  return (
    <>
      <DemoDataRibbon domains={["documents"]} />
      <LpDocumentCentreScreen initialCategory={params.category} initialDocumentId={params.document} />
    </>
  )
}
